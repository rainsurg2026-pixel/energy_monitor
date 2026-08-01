import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Server } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatRatioPercent, RACK_CANONICAL_STATUSES, statusRatio } from "../../utils/rackCapacity";
import { RACK_STATUS_DISPLAY_ORDER, RackDisplayStatus, rackStatusColorForRatio, rackStatusLabel } from "../../utils/rackStatusConfig";
import RackStatusBar from "./RackStatusBar";
import { RackStatusDistribution } from "./RackStatusDistribution";
import { ZoneHeatmap } from "./ZoneHeatmap";
import { useRackCapacity } from "./RackCapacityContext";
import { monthLabelLong } from "../../utils/monthUtils";

/** Internal-only filter sentinel for the aggregate "Other" column/segment -
 *  never a real status string in workbook data, so it can't collide. */
const OTHER_FILTER = "__other__";

export default function RackCapacitySummaryCard() {
  const { lang, rackCapacity: contextCapacity, metrics, reportingMonth } = useRackCapacity();
  const rackCapacity = contextCapacity;

  const [pivotOpen, setPivotOpen] = useState(true);
  const [detailFilter, setDetailFilter] = useState<{ zone: string | null; status: string | null }>({ zone: null, status: null });



  const visibleStatuses = useMemo(
    () => RACK_STATUS_DISPLAY_ORDER.filter(status => statusRatio(metrics, status).count > 0),
    [metrics]
  );
  const columnStatuses = useMemo(
    () => RACK_STATUS_DISPLAY_ORDER.filter(status => status !== "Other" || metrics.other.count > 0),
    [metrics]
  );

  const donutData = useMemo(
    () => visibleStatuses.map(status => {
      const { count, ratio } = statusRatio(metrics, status);
      return { name: status, value: count, ratio };
    }),
    [visibleStatuses, metrics]
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
          <h3 className="text-base text-slate-100">
            {lang === "th" ? "ความจุแร็คและการใช้งาน" : "Rack Capacity and Utilization"} — <span className="font-mono text-indigo-400">{monthLabelLong(reportingMonth, lang)}</span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">{lang === "th" ? "สรุปความจุ สถานะ และการใช้งานแร็ค" : "Rack capacity, status and utilization summary"}</p>
        </div>
      </div>

      {!rackCapacity ? (
        <p className="text-sm text-slate-500">{lang === "th" ? "ไม่พบข้อมูลความจุแร็คในเวิร์กบุ๊กปัจจุบัน" : "Rack capacity data is unavailable in the current workbook."}</p>
      ) : (
        <>
          {donutData.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm flex items-center justify-center">
                <div className="relative w-full sm:w-48 h-48 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                        {donutData.map(entry => <Cell key={entry.name} fill={rackStatusColorForRatio(entry.name, entry.ratio)} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-mono font-semibold text-slate-100">{metrics.inUse.count} / {metrics.total}</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{lang === "th" ? "ใช้แล้ว / ทั้งหมด" : "Used / Total"}</span>
                  </div>
                </div>
              </div>
              <RackStatusDistribution />
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
                                {count > 0 && <RackStatusBar ratio={ratio} colorHex={rackStatusColorForRatio(status, ratio)} className="mt-1" />}
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
                              {count > 0 && <RackStatusBar ratio={ratio} colorHex={rackStatusColorForRatio(status, ratio)} className="mt-1" />}
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

          <ZoneHeatmap />

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
