import { useMemo, useState } from "react";
import type { RackCapacitySummary, RackRecord } from "../reports/reportTypes";
import { ChevronDown, ChevronUp, Server } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { calculateRackCapacityMetrics, formatRatioPercent, RackStatusRatio } from "../utils/rackCapacity";

interface StatusRatioBreakdown {
  inUse: RackStatusRatio;
  available: RackStatusRatio;
  reserved: RackStatusRatio;
  pendingDismantle: RackStatusRatio;
}

interface RackCapacitySummaryCardProps {
  rackCapacity?: RackCapacitySummary | null;
  lang?: "th" | "en";
}

const PIVOT_STATUSES = ["Reserved", "Pending Dismantle", "In Use", "Available"] as const;
const DONUT_COLORS: Record<string, string> = {
  "In Use": "#34d399",
  "Available": "#38bdf8",
  "Reserved": "#fbbf24",
  "Pending Dismantle": "#f87171",
  "Other": "#94a3b8"
};

export default function RackCapacitySummaryCard({ rackCapacity = null, lang = "en" }: RackCapacitySummaryCardProps) {
  const [pivotOpen, setPivotOpen] = useState(true);
  const [detailFilter, setDetailFilter] = useState<{ zone: string | null; status: string | null }>({ zone: null, status: null });

  const metrics = useMemo(() => calculateRackCapacityMetrics(rackCapacity?.records ?? []), [rackCapacity]);

  const donutData = useMemo(() => {
    const entries: Array<{ name: string; value: number }> = [
      { name: "In Use", value: metrics.inUse.count },
      { name: "Available", value: metrics.available.count },
      { name: "Reserved", value: metrics.reserved.count },
      { name: "Pending Dismantle", value: metrics.pendingDismantle.count }
    ];
    if (metrics.other.count > 0) entries.push({ name: "Other", value: metrics.other.count });
    return entries.filter(entry => entry.value > 0);
  }, [metrics]);

  const pivotRows = useMemo(() => {
    if (!rackCapacity) return [];
    const rows = new Map<string, Record<string, number>>();
    for (const record of rackCapacity.records) {
      const zone = record.rackZone ?? "(blank)";
      const status = record.status ?? "(blank)";
      const counts = rows.get(zone) ?? {};
      counts[status] = (counts[status] ?? 0) + 1;
      counts.__total = (counts.__total ?? 0) + 1;
      rows.set(zone, counts);
    }
    return Array.from(rows.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([zone, counts]) => ({ zone, counts }));
  }, [rackCapacity]);

  const detailRecords = useMemo(() => {
    if (!rackCapacity || (!detailFilter.zone && !detailFilter.status)) return [];
    return rackCapacity.records.filter(record => {
      const zone = record.rackZone ?? "(blank)";
      const status = record.status ?? "(blank)";
      return (!detailFilter.zone || zone === detailFilter.zone) && (!detailFilter.status || status === detailFilter.status);
    });
  }, [rackCapacity, detailFilter]);

  const countForStatus = (status: string | null): number =>
    rackCapacity?.records.filter(record => status === null || (record.status ?? "(blank)") === status).length ?? 0;

  const selectFilter = (zone: string | null, status: string | null) => {
    setDetailFilter(current => current.zone === zone && current.status === status ? { zone: null, status: null } : { zone, status });
  };

  const statusCount = (status: string): number | null =>
    rackCapacity?.byStatus.find(item => item.status === status)?.count ?? null;

  const zoneMetricsByName = useMemo(() => new Map(metrics.zoneMetrics.map(z => [z.zone, z])), [metrics]);
  const ratioFor = (statusRatios: StatusRatioBreakdown, status: string): number | null => {
    switch (status) {
      case "In Use": return statusRatios.inUse.ratio;
      case "Available": return statusRatios.available.ratio;
      case "Reserved": return statusRatios.reserved.ratio;
      case "Pending Dismantle": return statusRatios.pendingDismantle.ratio;
      default: return null;
    }
  };
  const cellLabel = (count: number | undefined, ratio: number | null): string => {
    if (!count) return "";
    return `${count} (${formatRatioPercent(ratio, 1)})`;
  };

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-5">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400"><Server className="w-5 h-5" /></div>
        <div>
          <h3 className="text-base text-slate-100">{lang === "th" ? "ภาพรวมความจุแร็ค" : "Rack Capacity Overview"}</h3>
          <p className="text-xs text-slate-400 mt-1">{lang === "th" ? "สรุปจากชีท Rack Capacity / Table7" : "Summary from Rack Capacity / Table7"}</p>
        </div>
      </div>

      {!rackCapacity ? (
        <p className="text-sm text-slate-500">{lang === "th" ? "ไม่พบ Rack Capacity / Table7 ใน Workbook ปัจจุบัน" : "Rack Capacity / Table7 is unavailable in the current workbook."}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: lang === "th" ? "แร็คทั้งหมด" : "Total Racks", count: metrics.total, ratio: metrics.total > 0 ? 1 : null, tone: "text-slate-100", accent: "bg-slate-500" },
              { label: lang === "th" ? "ใช้งานอยู่" : "In Use", count: metrics.inUse.count, ratio: metrics.inUse.ratio, tone: "text-emerald-400", accent: "bg-emerald-500" },
              { label: lang === "th" ? "ว่าง" : "Available", count: metrics.available.count, ratio: metrics.available.ratio, tone: "text-sky-400", accent: "bg-sky-500" },
              { label: lang === "th" ? "จองไว้" : "Reserved", count: metrics.reserved.count, ratio: metrics.reserved.ratio, tone: "text-amber-400", accent: "bg-amber-400" },
              { label: lang === "th" ? "รอถอดถอน" : "Pending Dismantle", count: metrics.pendingDismantle.count, ratio: metrics.pendingDismantle.ratio, tone: "text-rose-400", accent: "bg-rose-400" }
            ].map(item => (
              <div key={item.label} className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <span className={`absolute inset-y-0 left-0 w-1 ${item.accent}`} />
                <p className="text-xs text-slate-400">{item.label}</p>
                <p className={`mt-1 text-2xl font-mono ${item.tone}`}>{item.count}</p>
                <p className="text-xs text-slate-500 font-mono">{formatRatioPercent(item.ratio)}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500">{lang === "th" ? "ไม่มีข้อมูลความจุหน่วย U ใน Workbook ต้นทาง จึงไม่แสดงและไม่ประมาณค่า" : "U-capacity metrics are unavailable in the source workbook and are not inferred."}</p>

          {donutData.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 flex flex-col sm:flex-row items-center gap-4">
              <div className="w-full sm:w-48 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                      {donutData.map(entry => <Cell key={entry.name} fill={DONUT_COLORS[entry.name] ?? "#94a3b8"} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2 text-xs w-full">
                <p className="text-sm text-slate-200 mb-2">{lang === "th" ? "การกระจายสถานะแร็ค" : "Rack Status Distribution"}</p>
                {donutData.map(entry => (
                  <div key={entry.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-slate-300"><span className="w-2.5 h-2.5 rounded-full" style={{ background: DONUT_COLORS[entry.name] ?? "#94a3b8" }} />{entry.name}</span>
                    <span className="font-mono text-slate-400">{entry.value} · {formatRatioPercent(entry.value / metrics.total)}</span>
                  </div>
                ))}
                <div className="pt-2 mt-2 border-t border-slate-800 flex items-center justify-between text-slate-300">
                  <span>{lang === "th" ? "อัตราการใช้งาน" : "Usage"}</span>
                  <span className="font-mono">{formatRatioPercent(metrics.inUse.ratio)}</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>{lang === "th" ? "อัตราว่าง" : "Availability"}</span>
                  <span className="font-mono">{formatRatioPercent(metrics.available.ratio)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <button type="button" onClick={() => setPivotOpen(open => !open)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800/50 transition-colors">
              <span className="flex items-center gap-2">{pivotOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}{lang === "th" ? "ตาราง Pivot ความจุแร็ค" : "Rack Capacity Pivot Table"}</span>
              <span className="text-xs text-slate-500">{lang === "th" ? "คลิกค่าเพื่อดูรายการ" : "Click a value to inspect records"}</span>
            </button>
            {pivotOpen && <div className="overflow-x-auto border-t border-slate-800"><table className="w-full min-w-[820px] text-xs border-collapse"><thead><tr className="bg-slate-950/50 text-left"><th className="py-3 px-4">{lang === "th" ? "โซนแร็ค" : "Rack Zone"}</th>{PIVOT_STATUSES.map(status => <th key={status} className="py-3 px-4 text-right">{status}</th>)}<th className="py-3 px-4 text-right">{lang === "th" ? "รวมทั้งหมด" : "Grand Total"}</th></tr></thead><tbody>{pivotRows.map(row => {
              const zoneMetrics = zoneMetricsByName.get(row.zone);
              return (
                <tr key={row.zone} className="border-t border-slate-800 hover:bg-slate-800/40">
                  <td className="py-3 px-4"><button type="button" onClick={() => selectFilter(row.zone, null)} className="underline decoration-dotted underline-offset-2 hover:text-indigo-400">{row.zone}</button></td>
                  {PIVOT_STATUSES.map(status => (
                    <td key={status} className="py-3 px-4 text-right">
                      <button type="button" onClick={() => selectFilter(row.zone, status)} className="min-w-8 hover:text-indigo-400 font-mono">
                        {zoneMetrics ? cellLabel(row.counts[status], ratioFor(zoneMetrics, status)) : (row.counts[status] ?? "")}
                      </button>
                    </td>
                  ))}
                  <td className="py-3 px-4 text-right"><button type="button" onClick={() => selectFilter(row.zone, null)} className="hover:text-indigo-400 font-mono">{row.counts.__total ?? 0}</button></td>
                </tr>
              );
            })}<tr className="border-t-2 border-slate-700"><td className="py-3 px-4">{lang === "th" ? "รวมทั้งหมด" : "Grand Total"}</td>{PIVOT_STATUSES.map(status => <td key={status} className="py-3 px-4 text-right"><button type="button" onClick={() => selectFilter(null, status)} className="hover:text-indigo-400 font-mono">{cellLabel(countForStatus(status) ?? 0, ratioFor(metrics, status))}</button></td>)}<td className="py-3 px-4 text-right font-mono">{rackCapacity.totalRacks}</td></tr></tbody></table></div>}
          </div>

          {detailRecords.length > 0 && <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-indigo-500/20 text-sm"><span>Rack details{detailFilter.zone ? ` · ${detailFilter.zone}` : ""}{detailFilter.status ? ` · ${detailFilter.status}` : ""} ({detailRecords.length})</span><button type="button" onClick={() => setDetailFilter({ zone: null, status: null })} className="text-indigo-400 hover:text-indigo-300">Clear filter</button></div><div className="overflow-x-auto max-h-80"><table className="w-full min-w-[980px] text-xs border-collapse"><thead><tr className="text-left"><th className="py-3 px-4">Rack Zone</th><th className="py-3 px-4">Rack ID</th><th className="py-3 px-4">Status</th><th className="py-3 px-4">Cabinet Size</th><th className="py-3 px-4">Detail</th><th className="py-3 px-4">Device Type</th><th className="py-3 px-4">Remarks</th></tr></thead><tbody>{detailRecords.map((record: RackRecord) => <tr key={`${record.rowNumber}-${record.rackId ?? "blank"}`} className="border-t border-slate-800"><td className="py-2 px-4">{record.rackZone ?? "—"}</td><td className="py-2 px-4">{record.rackId ?? "—"}</td><td className="py-2 px-4">{record.status ?? "—"}</td><td className="py-2 px-4">{record.cabinetSize ?? "—"}</td><td className="py-2 px-4">{record.detail ?? "—"}</td><td className="py-2 px-4">{record.deviceType ?? "—"}</td><td className="py-2 px-4">{record.remarks ?? "—"}</td></tr>)}</tbody></table></div></div>}
        </>
      )}
    </section>
  );
}
