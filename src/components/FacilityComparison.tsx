import React, { useEffect, useMemo, useState, useCallback } from "react";
import { BarChart4, RefreshCw, TrendingUp, Coins, Server, Gauge } from "lucide-react";
import type { FacilityEntry } from "../desktop";
import type { ExcelProvider } from "../data/ExcelProvider";
import type { DataSnapshot } from "../data/IDataProvider";
import {
  buildFacilityComparisonMetrics,
  getComparisonDisplayMonths,
  getComparisonMonths,
  getDefaultComparisonReferenceMonth,
  type ComparisonDisplayRange,
} from "../utils/facilityComparison";
import { formatNumber2, formatCompactLabel } from "../utils/numberFormatBridge";
import { formatMonthYear } from "../utils";
import { calculateRackCapacityMetrics, formatRatioPercent, type RackCapacityMetrics } from "../utils/rackCapacity";
import { usagePercent } from "../utils/rackUnitCapacity";
import { isMonthInDisplayPeriod } from "../utils/displayPeriod";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LabelList
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FacilityComparisonProps {
  facilities: FacilityEntry[];
  provider: ExcelProvider;
  lang: "th" | "en";
  displayPeriod?: string;
}

interface TableRow {
  facility: FacilityEntry;
  hasRecord: boolean;
  buildingEnergy: number | null;
  buildingCost: number | null;
  floorEnergy: number | null;
  floorCost: number | null;
  avgRate: number | null;
  floorShare: number | null;
}

interface CapacityRow {
  facility: FacilityEntry;
  rackMetrics: RackCapacityMetrics | null;
  rackUnitRow: NonNullable<DataSnapshot["rackUnitCapacity"]>[number] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function metric(val: number | null): string {
  return val === null || !Number.isFinite(val) ? "—" : formatNumber2(val);
}

function metricThb(val: number | null): string {
  return val === null || !Number.isFinite(val) ? "—" : `฿${formatNumber2(val)}`;
}

function metricPct(val: number | null): string {
  return val === null || !Number.isFinite(val) ? "—" : `${formatNumber2(val)}%`;
}

function monthOptionLabel(m: string): string {
  return `${m} (${formatMonthYear(m)})`;
}

// ---------------------------------------------------------------------------
// Custom Recharts Tooltip (full-precision values)
// ---------------------------------------------------------------------------

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: Array<{ name: string; value: number | null; color: string }>; label?: string; unit: "kWh" | "THB" }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs shadow-xl max-w-56">
      <p className="font-semibold text-slate-200 mb-1.5">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="flex justify-between gap-3" style={{ color: entry.color }}>
          <span>{entry.name}:</span>
          <span className="font-mono">{entry.value !== null && entry.value !== undefined ? `${formatNumber2(entry.value)} ${unit}` : "—"}</span>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function FacilityComparison({ facilities, provider, lang, displayPeriod = "2026" }: FacilityComparisonProps) {
  const th = lang === "th";

  // --- state ---
  const [snapshots, setSnapshots] = useState<Map<string, DataSnapshot> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [referenceMonth, setReferenceMonth] = useState<string | null>(null);
  const [displayRange, setDisplayRange] = useState<ComparisonDisplayRange>(12);

  // --- load ---
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await provider.loadMultipleFacilities(
        facilities.map(f => ({
          path: f.workbook,
          label: f.name,
          devices: {
            upsIds: f.profile.devices.ups,
            dcIds: f.profile.devices.dc,
            airFields: f.profile.air.fields
          }
        }))
      );
      setSnapshots(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSnapshots(null);
    } finally {
      setLoading(false);
    }
  }, [facilities, provider]);

  useEffect(() => { void load(); }, [load]);

  // Comparison rules live in one pure utility. Workbook paths remain keys so
  // each facility's records stay isolated through provider, IPC, and renderer.
  const histories = useMemo(() => facilities.map(facility => ({
    id: facility.id,
    logs: snapshots?.get(facility.workbook)?.logs ?? [],
  })), [facilities, snapshots]);

  const availableMonths = useMemo(
    () => getComparisonMonths(histories).filter(month => isMonthInDisplayPeriod(month, displayPeriod)),
    [histories, displayPeriod]
  );

  useEffect(() => {
    if (!snapshots) return;
    if (availableMonths.length === 0) {
      setReferenceMonth(null);
      return;
    }
    if (!referenceMonth || !availableMonths.includes(referenceMonth)) {
      const defaultMonth = getDefaultComparisonReferenceMonth(histories);
      setReferenceMonth(
        availableMonths.includes(defaultMonth) ? defaultMonth : availableMonths[availableMonths.length - 1] ?? null
      );
    }
  }, [snapshots, availableMonths, histories, referenceMonth]);

  const visibleMonths = useMemo(
    () => getComparisonDisplayMonths(availableMonths, referenceMonth, displayRange),
    [availableMonths, referenceMonth, displayRange]
  );

  const metricsCache = useMemo(() => new Map(histories.map(history => [
    history.id,
    buildFacilityComparisonMetrics(history.logs),
  ])), [histories]);

  // --- table rows (reference month only) ---
  const tableRows: TableRow[] = useMemo(() => {
    return facilities.map(facility => {
      const values = referenceMonth ? metricsCache.get(facility.id)?.get(referenceMonth) : null;
      const hasRecord = referenceMonth !== null && values !== undefined;
      return {
        facility,
        hasRecord: Boolean(hasRecord),
        buildingEnergy: values?.buildingEnergy ?? null,
        buildingCost: values?.buildingCost ?? null,
        floorEnergy: values?.floorEnergy ?? null,
        floorCost: values?.floorCost ?? null,
        avgRate: values?.avgRate ?? null,
        floorShare: values?.floorShare ?? null,
      };
    });
  }, [referenceMonth, metricsCache, facilities, histories]);

  // --- chart data: visible months ---
  const chartData = useMemo(() => {
    return visibleMonths.map(m => {
      const base: Record<string, number | null | string> = {
        month: m,
        label: formatMonthYear(m),
      };
      for (const f of facilities) {
        const values = metricsCache.get(f.id)?.get(m);
        base[`${f.id}_energy`] = values?.buildingEnergy ?? null;
        base[`${f.id}_cost`] = values?.floorCost ?? null;
      }
      return base;
    });
  }, [visibleMonths, metricsCache, facilities]);

  const capacityRows = useMemo<CapacityRow[]>(() => facilities.map(facility => {
    const snapshot = snapshots?.get(facility.workbook);
    const rackRecords = snapshot?.rackCapacity?.records;
    const rackMetrics = rackRecords ? calculateRackCapacityMetrics(rackRecords) : null;
    const unitRows = [...(snapshot?.rackUnitCapacity ?? [])].sort((a, b) => a.month.localeCompare(b.month));
    const rackUnitRow = referenceMonth
      ? unitRows.filter(row => row.month <= referenceMonth).at(-1) ?? null
      : unitRows.at(-1) ?? null;
    return { facility, rackMetrics, rackUnitRow };
  }), [facilities, referenceMonth, snapshots]);

  // --- site colours ---
  const siteColour = useCallback((id: string) => id === "rangsit" ? "#e87959" : "#5b8db8", []);

  // --- i18n ---
  const t = {
    title: th ? "เปรียบเทียบไซต์" : "Site Comparison",
    desc: th ? "อ่านไฟล์ Excel ของแต่ละไซต์แยกกัน ไม่แก้ไขไฟล์หรือสลับไซต์ที่กำลังใช้งาน" : "Reads each facility workbook independently. Does not modify files or switch active facility.",
    reload: th ? "โหลดใหม่" : "Reload",
    refMonth: th ? "เลือกเดือนอ้างอิง" : "Reference Month",
    range: th ? "ช่วงเวลาที่แสดงผล" : "Display Range",
    r3: th ? "ย้อนหลัง 3 เดือน" : "Last 3 Months",
    r6: th ? "ย้อนหลัง 6 เดือน" : "Last 6 Months",
    r12: th ? "ย้อนหลัง 12 เดือน" : "Last 12 Months",

    colSite: th ? "ไซต์" : "Site",
    colReportMonth: th ? "เดือนที่รายงาน" : "Reporting Month",
    colBuildingEnergy: th ? "การใช้พลังงานทั้งอาคาร (kWh)" : "Whole Building Energy (kWh)",
    colBuildingCost: th ? "ค่าไฟฟ้าทั้งอาคาร (บาท)" : "Whole Building Electricity Cost (THB)",
    colFloorEnergy: th ? "การใช้พลังงานชั้น 4 (kWh)" : "Floor 4 Energy (kWh)",
    colFloorCost: th ? "ค่าไฟฟ้าชั้น 4 (บาท)" : "Floor 4 Electricity Cost (THB)",
    colAvgRate: th ? "อัตราค่าไฟเฉลี่ย (บาท/kWh)" : "Average Electricity Rate (THB/kWh)",
    colFloorShare: th ? "สัดส่วนพลังงานชั้น 4 (%)" : "Floor 4 Energy Share (%)",

    energyTrend: th ? "แนวโน้มการใช้พลังงานรายเดือน (kWh) เทียบกันสองไซต์" : "Monthly Energy Consumption Trend (kWh) — Site Comparison",
    costTrend: th ? "ประมาณการค่าไฟชั้น 4 (บาท) Trend (THB)" : "Floor 4 Electricity Cost Trend (THB)",
    loading: th ? "กำลังโหลด..." : "Loading...",
    noData: th ? "ไม่มีข้อมูล" : "No data",
    unavailable: th ? "ไม่มีข้อมูลเดือนที่เลือก" : "No record for selected month",
  };

  const rangeOptions: { value: ComparisonDisplayRange; label: string }[] = [
    { value: 3, label: t.r3 },
    { value: 6, label: t.r6 },
    { value: 12, label: t.r12 },
  ];

  const hasChartData = chartData.length > 0;
  const chartMinWidth = Math.max(640, visibleMonths.length * 76);

  // --- render ---
  return (
    <section className="space-y-5 animate-fadeIn" data-testid="facility-comparison">
      {/* ---- header ---- */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="p-3 rounded-xl bg-indigo-500/10 text-indigo-400"><BarChart4 className="w-6 h-6" /></span>
          <div>
            <h2 className="text-base font-bold text-slate-100">{t.title}</h2>
            <p className="text-xs text-slate-400 mt-1">{t.desc}</p>
          </div>
        </div>
        <button onClick={load} disabled={loading} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold flex items-center justify-center gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          {t.reload}
        </button>
      </div>

      {/* ---- controls: reference month + display range ---- */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex flex-col sm:flex-row gap-4 sm:items-center">
        {/* Reference month */}
        <div className="flex items-center gap-2">
          <label id="comparison-reference-month-label" htmlFor="comparison-reference-month" className="text-xs font-semibold text-slate-300 whitespace-nowrap">{t.refMonth}</label>
          <select
            id="comparison-reference-month"
            aria-labelledby="comparison-reference-month-label"
            className="bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-xl px-3 py-2 min-w-44"
            data-testid="comparison-reference-month"
            value={referenceMonth ?? ""}
            onChange={e => setReferenceMonth(e.target.value)}
            disabled={loading || availableMonths.length === 0}
          >
            {availableMonths.length === 0 && <option value="">{t.loading}</option>}
            {availableMonths.map(m => (
              <option key={m} value={m}>{monthOptionLabel(m)}</option>
            ))}
          </select>
        </div>

        {/* Display range */}
        <div className="flex items-center gap-2">
          <span id="comparison-range-label" className="text-xs font-semibold text-slate-300 whitespace-nowrap">{t.range}</span>
          <div role="group" aria-labelledby="comparison-range-label" className="flex gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            {rangeOptions.map(opt => (
              <button
                key={opt.value}
                data-testid={`comparison-range-${opt.value}`}
                aria-pressed={displayRange === opt.value}
                onClick={() => setDisplayRange(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg ${displayRange === opt.value ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- error ---- */}
      {error && <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-200">{error}</div>}

      {/* ---- comparison table ---- */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-240 text-sm">
          <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase tracking-wider">
            <tr>
              <th className="p-4 text-left">{t.colSite}</th>
              <th className="p-4 text-right">{t.colReportMonth}</th>
              <th className="p-4 text-right">{t.colBuildingEnergy}</th>
              <th className="p-4 text-right">{t.colBuildingCost}</th>
              <th className="p-4 text-right">{t.colFloorEnergy}</th>
              <th className="p-4 text-right">{t.colFloorCost}</th>
              <th className="p-4 text-right">{t.colAvgRate}</th>
              <th className="p-4 text-right">{t.colFloorShare}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {tableRows.map(row => {
              const isRangsit = row.facility.id === "rangsit";
              return (
                <tr
                  key={row.facility.id}
                  className={`text-slate-200 ${isRangsit ? "bg-red-500/4 border-l-4 border-l-red-500/30" : "bg-blue-500/4 border-l-4 border-l-blue-500/30"}`}
                >
                  <td className="p-4">
                    <div className="font-bold text-sm">{row.facility.name}</div>
                    <div className="text-xs text-slate-500">{row.facility.profile.displayName}</div>
                  </td>
                  <td className="p-4 text-right font-mono text-xs">
                    {row.hasRecord && referenceMonth ? formatMonthYear(referenceMonth) : "—"}
                    {!row.hasRecord && referenceMonth && <div className="mt-1 text-[10px] font-sans text-amber-300">{t.unavailable}</div>}
                  </td>
                  <td className="p-4 text-right font-mono">{metric(row.buildingEnergy)}</td>
                  <td className="p-4 text-right font-mono">{metricThb(row.buildingCost)}</td>
                  <td className="p-4 text-right font-mono">{metric(row.floorEnergy)}</td>
                  <td className="p-4 text-right font-mono">{metricThb(row.floorCost)}</td>
                  <td className="p-4 text-right font-mono">{metric(row.avgRate)}</td>
                  <td className="p-4 text-right font-mono">{metricPct(row.floorShare)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- charts ---- */}
      {!hasChartData && !loading && !error && (
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center text-sm text-slate-400">{t.noData}</div>
      )}
      {hasChartData && (
        <div className="space-y-6">
          {/* Energy trend chart */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl" data-testid="comparison-energy-chart" data-month-count={visibleMonths.length} data-reference-month={referenceMonth ?? ""}>
            <h3 className="text-sm font-bold text-slate-200 mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              {t.energyTrend}
            </h3>
            <div className="h-72 overflow-x-auto overflow-y-hidden overscroll-x-contain">
              <div className="h-full" style={{ width: chartMinWidth, minWidth: "100%" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 28, right: 8, left: 4, bottom: 24 }}>
                  <title>Monthly energy comparison</title>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" tick={{ fill: "#9CA3AF", fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={value => formatCompactLabel(value)} tick={{ fill: "#9CA3AF", fontSize: 10 }} width={60} />
                  <Tooltip content={<ChartTooltip unit="kWh" />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {facilities.map(f => (
                    <Line
                      key={`energy-${f.id}`}
                      type="monotone"
                      dataKey={`${f.id}_energy`}
                      name={f.name}
                      stroke={siteColour(f.id)}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                      connectNulls={false}
                    >
                      <LabelList
                        dataKey={`${f.id}_energy`}
                        formatter={(v: number) => formatCompactLabel(v)}
                        position={f.id === "rangsit" ? "top" : "bottom"}
                        fontSize={visibleMonths.length > 6 ? 9 : 10}
                        fill={siteColour(f.id)}
                        offset={4}
                      />
                    </Line>
                  ))}
                </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Floor 4 cost trend chart */}
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl" data-testid="comparison-cost-chart" data-month-count={visibleMonths.length} data-reference-month={referenceMonth ?? ""}>
            <h3 className="text-sm font-bold text-slate-200 mb-3 flex items-center gap-2">
              <Coins className="w-4 h-4 text-emerald-400" />
              {t.costTrend}
            </h3>
            <div className="h-72 overflow-x-auto overflow-y-hidden overscroll-x-contain">
              <div className="h-full" style={{ width: chartMinWidth, minWidth: "100%" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 28, right: 8, left: 4, bottom: 24 }}>
                  <title>Floor 4 electricity cost comparison</title>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="label" tick={{ fill: "#9CA3AF", fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={value => formatCompactLabel(value)} tick={{ fill: "#9CA3AF", fontSize: 10 }} width={60} />
                  <Tooltip content={<ChartTooltip unit="THB" />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {facilities.map(f => (
                    <Line
                      key={`cost-${f.id}`}
                      type="monotone"
                      dataKey={`${f.id}_cost`}
                      name={f.name}
                      stroke={siteColour(f.id)}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                      connectNulls={false}
                    >
                      <LabelList
                        dataKey={`${f.id}_cost`}
                        formatter={(v: number) => formatCompactLabel(v)}
                        position={f.id === "rangsit" ? "top" : "bottom"}
                        fontSize={visibleMonths.length > 6 ? 9 : 10}
                        fill={siteColour(f.id)}
                        offset={4}
                      />
                    </Line>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ---- real rack capacity data ---- */}
      <div className="space-y-6">
        <section className="bg-slate-900 border border-slate-800 p-5 rounded-2xl" data-testid="comparison-rack-capacity">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-indigo-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-200">{th ? "เปรียบเทียบความจุและการใช้งาน Rack" : "Site Comparison Rack Capacity and Utilization"}</h3>
              <p className="text-[11px] text-slate-400 mt-1">{th ? "ข้อมูลจริงจาก Rack Capacity ของแต่ละ workbook" : "Live Rack Capacity records from each facility workbook."}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {capacityRows.map(row => {
              const metrics = row.rackMetrics;
              return (
                <article key={row.facility.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4" data-testid={`comparison-rack-capacity-${row.facility.id}`}>
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h4 className="font-bold text-slate-100">{row.facility.name}</h4>
                    {metrics && <span className="text-xs font-mono text-slate-400">{metrics.total} racks</span>}
                  </div>
                  {!metrics ? (
                    <p className="text-xs text-slate-500">{t.noData}</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between text-xs text-slate-300"><span>Utilization</span><strong className="font-mono text-indigo-300">{formatRatioPercent(metrics.inUse.ratio)}</strong></div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${Math.max(0, Math.min(100, (metrics.inUse.ratio ?? 0) * 100))}%` }} /></div>
                      <div className="grid grid-cols-4 gap-2 text-[10px] font-mono">
                        <div><span className="block text-slate-500">In Use</span><strong className="text-indigo-300">{metrics.inUse.count}</strong></div>
                        <div><span className="block text-slate-500">Available</span><strong className="text-emerald-300">{metrics.available.count}</strong></div>
                        <div><span className="block text-slate-500">Reserved</span><strong className="text-amber-300">{metrics.reserved.count}</strong></div>
                        <div><span className="block text-slate-500">Other</span><strong className="text-slate-300">{metrics.other.count}</strong></div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 p-5 rounded-2xl" data-testid="comparison-rack-unit-capacity">
          <div className="flex items-center gap-2 mb-4">
            <Gauge className="w-4 h-4 text-teal-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-200">{th ? "เปรียบเทียบความจุและการใช้งาน Rack Unit" : "Site Comparison Rack Unit Capacity and Utilization"}</h3>
              <p className="text-[11px] text-slate-400 mt-1">{th ? "ข้อมูลจริงจาก Rack Unit Capacity ของแต่ละ workbook" : "Live Rack Unit Capacity rows; no values are inferred from rack count."}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {capacityRows.map(row => (
              <article key={row.facility.id} className="bg-slate-950/60 border border-slate-800 rounded-xl p-4" data-testid={`comparison-rack-unit-capacity-${row.facility.id}`}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="font-bold text-slate-100">{row.facility.name}</h4>
                  {row.rackUnitRow && <span className="text-[10px] font-mono text-slate-500">{formatMonthYear(row.rackUnitRow.month)}</span>}
                </div>
                {!row.rackUnitRow ? (
                  <p className="text-xs text-slate-500">{t.noData}</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div><span className="block text-slate-500">Total U</span><strong className="font-mono text-slate-100">{formatNumber2(row.rackUnitRow.totalU)}</strong></div>
                    <div><span className="block text-slate-500">Used U</span><strong className="font-mono text-indigo-300">{formatNumber2(row.rackUnitRow.usedU)}</strong></div>
                    <div><span className="block text-slate-500">Available U</span><strong className="font-mono text-emerald-300">{formatNumber2(row.rackUnitRow.availableU)}</strong></div>
                    <div><span className="block text-slate-500">Utilization</span><strong className="font-mono text-teal-300">{usagePercent(row.rackUnitRow) === null ? "—" : `${formatNumber2(usagePercent(row.rackUnitRow))}%`}</strong></div>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
