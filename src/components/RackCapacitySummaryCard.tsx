import { useMemo, useState } from "react";
import type { RackCapacitySummary } from "../reports/reportTypes";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { ChevronDown, ChevronUp, Server } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { calculateRackCapacityMetrics, formatRatioPercent, RACK_CANONICAL_STATUSES, RackCapacityMetrics, RackZoneMetrics } from "../utils/rackCapacity";
import { RACK_STATUS_DISPLAY_ORDER, RackDisplayStatus, rackStatusHex, rackStatusLabel } from "../utils/rackStatusConfig";
import RackStatusBar from "./RackStatusBar";

/** Internal-only filter sentinel for the aggregate "Other" column/segment -
 *  never a real status string in workbook data, so it can't collide. */
const OTHER_FILTER = "__other__";

interface RackCapacitySummaryCardProps {
  rackCapacity?: RackCapacitySummary | null;
  lang?: "th" | "en";
  /** Persisted Rack Unit Capacity rows (all months), plus which month is
   *  currently active in the Rack Capacity Management view, so this card's
   *  U-capacity section shows that SAME month's data (or an honest
   *  month-scoped empty state) rather than a blanket "unavailable" claim. */
  rackUnitCapacity?: RackUnitCapacityRow[];
  unitCapacityMonth?: string | null;
}

function statusRatio(m: RackCapacityMetrics | RackZoneMetrics, status: RackDisplayStatus): { count: number; ratio: number | null } {
  switch (status) {
    case "In Use": return m.inUse;
    case "Available": return m.available;
    case "Reserved": return m.reserved;
    case "Pending Dismantle": return m.pendingDismantle;
    case "Other": return m.other;
  }
}

const MONTH_NAMES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_NAMES_TH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function monthLabel(month: string, lang: "th" | "en"): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const names = lang === "th" ? MONTH_NAMES_TH : MONTH_NAMES_EN;
  if (!Number.isFinite(year) || !names[monthIndex]) return month;
  return `${names[monthIndex]} ${year}`;
}

export default function RackCapacitySummaryCard({ rackCapacity = null, lang = "en", rackUnitCapacity = [], unitCapacityMonth = null }: RackCapacitySummaryCardProps) {
  const [pivotOpen, setPivotOpen] = useState(true);
  const [detailFilter, setDetailFilter] = useState<{ zone: string | null; status: string | null }>({ zone: null, status: null });

  const metrics = useMemo(() => calculateRackCapacityMetrics(rackCapacity?.records ?? []), [rackCapacity]);

  const visibleStatuses = useMemo(
    () => RACK_STATUS_DISPLAY_ORDER.filter(status => statusRatio(metrics, status).count > 0),
    [metrics]
  );
  const columnStatuses = useMemo(
    () => RACK_STATUS_DISPLAY_ORDER.filter(status => status !== "Other" || metrics.other.count > 0),
    [metrics]
  );

  const donutData = useMemo(() => visibleStatuses.map(status => ({ name: status, value: statusRatio(metrics, status).count })), [visibleStatuses, metrics]);

  const unitCapacityRow = useMemo(
    () => (unitCapacityMonth ? rackUnitCapacity.find(row => row.month === unitCapacityMonth) ?? null : null),
    [rackUnitCapacity, unitCapacityMonth]
  );

  const detailRecords = useMemo(() => {
    if (!rackCapacity || (!detailFilter.zone && !detailFilter.status)) return [];
    return rackCapacity.records.filter(record => {
      const zone = record.rackZone ?? "(blank)";
      const status = record.status ?? "(blank)";
      if (detailFilter.zone && zone !== detailFilter.zone) return false;
      if (!detailFilter.status) return true;
      if (detailFilter.status === OTHER_FILTER) return !RACK_CANONICAL_STATUSES.includes(status as (typeof RACK_CANONICAL_STATUSES)[number]);
      return status === detailFilter.status;
    });
  }, [rackCapacity, detailFilter]);

  const selectFilter = (zone: string | null, status: string | null) => {
    setDetailFilter(current => (current.zone === zone && current.status === status ? { zone: null, status: null } : { zone, status }));
  };

  const cellLabel = (count: number, ratio: number | null): string => (count ? `${count} (${formatRatioPercent(ratio, 1)})` : "—");
  const filterKeyFor = (status: RackDisplayStatus): string => (status === "Other" ? OTHER_FILTER : status);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-5">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400"><Server className="w-5 h-5" /></div>
        <div>
          <h3 className="text-base text-slate-100">{lang === "th" ? "ความจุแร็คและการใช้งาน" : "Rack Capacity and Utilization"}</h3>
          <p className="text-xs text-slate-400 mt-1">{lang === "th" ? "สรุปความจุ สถานะ และการใช้งานแร็ค" : "Rack capacity, status and utilization summary"}</p>
        </div>
      </div>

      {!rackCapacity ? (
        <p className="text-sm text-slate-500">{lang === "th" ? "ไม่พบข้อมูลความจุแร็คในเวิร์กบุ๊กปัจจุบัน" : "Rack capacity data is unavailable in the current workbook."}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <span className="absolute inset-y-0 left-0 w-1 bg-slate-500" />
              <p className="text-xs text-slate-400">{lang === "th" ? "แร็คทั้งหมด" : "Total Racks"}</p>
              <p className="mt-1 text-2xl font-mono text-slate-100">{metrics.total}</p>
              <p className="text-xs text-slate-500 font-mono">{formatRatioPercent(metrics.total > 0 ? 1 : null)}</p>
            </div>
            {RACK_CANONICAL_STATUSES.map(status => {
              const { count, ratio } = statusRatio(metrics, status);
              const hex = rackStatusHex(status);
              return (
                <div key={status} className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                  <span className="absolute inset-y-0 left-0 w-1" style={{ background: hex }} />
                  <p className="text-xs text-slate-400">{rackStatusLabel(status, lang)}</p>
                  <p className="mt-1 text-2xl font-mono" style={{ color: hex }}>{count}</p>
                  <p className="text-xs text-slate-500 font-mono">{formatRatioPercent(ratio)}</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h4 className="text-sm text-slate-200">{lang === "th" ? "ความจุหน่วยแร็ค (U)" : "Rack Unit Capacity"}</h4>
              {unitCapacityMonth && <span className="text-xs text-slate-500">{monthLabel(unitCapacityMonth, lang)}</span>}
            </div>
            {unitCapacityRow ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: lang === "th" ? "ทั้งหมด (U)" : "Total (U)", value: String(unitCapacityRow.totalU) },
                  { label: lang === "th" ? "ใช้แล้ว (U)" : "Used (U)", value: String(unitCapacityRow.usedU) },
                  { label: lang === "th" ? "ว่าง (U)" : "Available (U)", value: String(unitCapacityRow.availableU) },
                  { label: lang === "th" ? "% ความจุที่ว่าง" : "Availability Capacity (%)", value: formatRatioPercent(unitCapacityRow.availabilityPct) }
                ].map(item => (
                  <div key={item.label} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    <p className="text-[11px] text-slate-500">{item.label}</p>
                    <p className="mt-1 text-lg font-mono text-slate-100">{item.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                {lang === "th" ? "ไม่มีข้อมูลความจุหน่วย U สำหรับเดือนที่เลือก" : "No Rack Unit Capacity data for the selected month."}
              </p>
            )}
            <p className="text-[11px] text-slate-600 mt-3">
              {lang === "th"
                ? "เป็นมิติที่แยกต่างหากจากจำนวนแร็ค ไม่ใช้ตัวหารร่วมกับ % ความพร้อมใช้งานของแร็คด้านบน"
                : "A separate dimension from rack count — never shares a denominator with the rack-count Availability % above."}
            </p>
          </div>

          {donutData.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="relative w-full sm:w-48 h-48 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                      {donutData.map(entry => <Cell key={entry.name} fill={rackStatusHex(entry.name)} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-mono font-semibold text-slate-100">{metrics.total}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">{lang === "th" ? "แร็คทั้งหมด" : "Total Racks"}</span>
                </div>
              </div>
              <div className="flex-1 space-y-2.5 text-xs w-full">
                <p className="text-sm text-slate-200 mb-1">{lang === "th" ? "การกระจายสถานะแร็ค" : "Rack Status Distribution"}</p>
                {visibleStatuses.map(status => {
                  const { count, ratio } = statusRatio(metrics, status);
                  const hex = rackStatusHex(status);
                  return (
                    <div key={status} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-slate-300"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: hex }} />{rackStatusLabel(status, lang)}</span>
                        <span className="font-mono text-slate-400 shrink-0">{count} · {formatRatioPercent(ratio)}</span>
                      </div>
                      <RackStatusBar ratio={ratio} colorHex={hex} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <button type="button" onClick={() => setPivotOpen(open => !open)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800/50 transition-colors">
              <span className="flex items-center gap-2">{pivotOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}{lang === "th" ? "ตารางความจุแร็คตามโซน" : "Rack Zone Capacity Table"}</span>
              <span className="text-xs text-slate-500">{lang === "th" ? "คลิกค่าเพื่อดูรายการ" : "Click a value to inspect records"}</span>
            </button>
            {pivotOpen && (
              <div className="overflow-x-auto border-t border-slate-800">
                <table className="w-full min-w-[860px] text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-950/50 text-left">
                      <th className="py-3 px-4">{lang === "th" ? "โซนแร็ค" : "Rack Zone"}</th>
                      {columnStatuses.map(status => <th key={status} className="py-3 px-4 text-right">{rackStatusLabel(status, lang)}</th>)}
                      <th className="py-3 px-4 text-right">{lang === "th" ? "รวมทั้งหมด" : "Grand Total"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.zoneMetrics.map(zone => (
                      <tr key={zone.zone} className="border-t border-slate-800 hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <button type="button" onClick={() => selectFilter(zone.zone, null)} className="underline decoration-dotted underline-offset-2 hover:text-indigo-400">{zone.zone}</button>
                        </td>
                        {columnStatuses.map(status => {
                          const { count, ratio } = statusRatio(zone, status);
                          return (
                            <td key={status} className="py-3 px-4 text-right align-middle">
                              <button type="button" onClick={() => selectFilter(zone.zone, filterKeyFor(status))} className="min-w-16 hover:text-indigo-400">
                                <span className="font-mono block">{cellLabel(count, ratio)}</span>
                                {count > 0 && <RackStatusBar ratio={ratio} colorHex={rackStatusHex(status)} className="mt-1" />}
                              </button>
                            </td>
                          );
                        })}
                        <td className="py-3 px-4 text-right"><button type="button" onClick={() => selectFilter(zone.zone, null)} className="hover:text-indigo-400 font-mono">{zone.total}</button></td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-600 bg-slate-800/60 font-semibold">
                      <td className="py-3 px-4">{lang === "th" ? "รวมทั้งหมด" : "Grand Total"}</td>
                      {columnStatuses.map(status => {
                        const { count, ratio } = statusRatio(metrics, status);
                        return (
                          <td key={status} className="py-3 px-4 text-right align-middle">
                            <button type="button" onClick={() => selectFilter(null, filterKeyFor(status))} className="min-w-16 hover:text-indigo-400">
                              <span className="font-mono block">{cellLabel(count, ratio)}</span>
                              {count > 0 && <RackStatusBar ratio={ratio} colorHex={rackStatusHex(status)} className="mt-1" />}
                            </button>
                          </td>
                        );
                      })}
                      <td className="py-3 px-4 text-right font-mono">{rackCapacity.totalRacks}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {detailRecords.length > 0 && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-indigo-500/20 text-sm">
                <span>Rack details{detailFilter.zone ? ` · ${detailFilter.zone}` : ""}{detailFilter.status ? ` · ${detailFilter.status === OTHER_FILTER ? rackStatusLabel("Other", lang) : detailFilter.status}` : ""} ({detailRecords.length})</span>
                <button type="button" onClick={() => setDetailFilter({ zone: null, status: null })} className="text-indigo-400 hover:text-indigo-300">Clear filter</button>
              </div>
              <div className="overflow-x-auto max-h-80">
                <table className="w-full min-w-[980px] text-xs border-collapse">
                  <thead><tr className="text-left"><th className="py-3 px-4">Rack Zone</th><th className="py-3 px-4">Rack ID</th><th className="py-3 px-4">Status</th><th className="py-3 px-4">Cabinet Size</th><th className="py-3 px-4">Detail</th><th className="py-3 px-4">Device Type</th><th className="py-3 px-4">Remarks</th></tr></thead>
                  <tbody>
                    {detailRecords.map(record => (
                      <tr key={`${record.rowNumber}-${record.rackId ?? "blank"}`} className="border-t border-slate-800">
                        <td className="py-2 px-4">{record.rackZone ?? "—"}</td>
                        <td className="py-2 px-4">{record.rackId ?? "—"}</td>
                        <td className="py-2 px-4">{record.status ?? "—"}</td>
                        <td className="py-2 px-4">{record.cabinetSize ?? "—"}</td>
                        <td className="py-2 px-4">{record.detail ?? "—"}</td>
                        <td className="py-2 px-4">{record.deviceType ?? "—"}</td>
                        <td className="py-2 px-4">{record.remarks ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
