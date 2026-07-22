import { useMemo, useState } from "react";
import type { RackCapacitySummary, RackRecord } from "../reports/reportTypes";
import { ChevronDown, ChevronUp, Server } from "lucide-react";

interface RackCapacitySummaryCardProps {
  rackCapacity?: RackCapacitySummary | null;
}

const PIVOT_STATUSES = ["Reserved", "Pending Dismantle", "In Use", "Available"] as const;

export default function RackCapacitySummaryCard({ rackCapacity = null }: RackCapacitySummaryCardProps) {
  const [pivotOpen, setPivotOpen] = useState(true);
  const [detailFilter, setDetailFilter] = useState<{ zone: string | null; status: string | null }>({ zone: null, status: null });

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

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-5">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400"><Server className="w-5 h-5" /></div>
        <div>
          <h3 className="text-base text-slate-100">Rack Capacity Overview</h3>
          <p className="text-xs text-slate-400 mt-1">Read-only summary from Rack Capacity / Table7</p>
        </div>
      </div>

      {!rackCapacity ? (
        <p className="text-sm text-slate-500">Rack Capacity / Table7 is unavailable in the current workbook.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Total Racks", value: rackCapacity.totalRacks, tone: "text-slate-100", accent: "bg-slate-500" },
              { label: "In Use", value: statusCount("In Use"), tone: "text-emerald-400", accent: "bg-emerald-500" },
              { label: "Available", value: statusCount("Available"), tone: "text-sky-400", accent: "bg-sky-500" },
              { label: "Reserved", value: statusCount("Reserved"), tone: "text-amber-400", accent: "bg-amber-400" }
            ].map(item => <div key={item.label} className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40 p-4"><span className={`absolute inset-y-0 left-0 w-1 ${item.accent}`} /><p className="text-xs text-slate-400">{item.label}</p><p className={`mt-1 text-2xl font-mono ${item.tone}`}>{item.value ?? "—"}</p></div>)}
          </div>

          <p className="text-xs text-slate-500">U-capacity metrics are unavailable in the source workbook and are not inferred.</p>

          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <button type="button" onClick={() => setPivotOpen(open => !open)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm text-slate-200 hover:bg-slate-800/50 transition-colors">
              <span className="flex items-center gap-2">{pivotOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}Rack Capacity Pivot Table</span>
              <span className="text-xs text-slate-500">Click a value to inspect records</span>
            </button>
            {pivotOpen && <div className="overflow-x-auto border-t border-slate-800"><table className="w-full min-w-[720px] text-xs border-collapse"><thead><tr className="bg-slate-950/50 text-left"><th className="py-3 px-4">Rack Zone</th>{PIVOT_STATUSES.map(status => <th key={status} className="py-3 px-4 text-right">{status}</th>)}<th className="py-3 px-4 text-right">Grand Total</th></tr></thead><tbody>{pivotRows.map(row => <tr key={row.zone} className="border-t border-slate-800 hover:bg-slate-800/40"><td className="py-3 px-4"><button type="button" onClick={() => selectFilter(row.zone, null)} className="underline decoration-dotted underline-offset-2 hover:text-indigo-400">{row.zone}</button></td>{PIVOT_STATUSES.map(status => <td key={status} className="py-3 px-4 text-right"><button type="button" onClick={() => selectFilter(row.zone, status)} className="min-w-8 hover:text-indigo-400">{row.counts[status] ?? ""}</button></td>)}<td className="py-3 px-4 text-right"><button type="button" onClick={() => selectFilter(row.zone, null)} className="hover:text-indigo-400">{row.counts.__total ?? 0}</button></td></tr>)}<tr className="border-t-2 border-slate-700"><td className="py-3 px-4">Grand Total</td>{PIVOT_STATUSES.map(status => <td key={status} className="py-3 px-4 text-right"><button type="button" onClick={() => selectFilter(null, status)} className="hover:text-indigo-400">{countForStatus(status) || ""}</button></td>)}<td className="py-3 px-4 text-right">{rackCapacity.totalRacks}</td></tr></tbody></table></div>}
          </div>

          {detailRecords.length > 0 && <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-indigo-500/20 text-sm"><span>Rack details{detailFilter.zone ? ` · ${detailFilter.zone}` : ""}{detailFilter.status ? ` · ${detailFilter.status}` : ""} ({detailRecords.length})</span><button type="button" onClick={() => setDetailFilter({ zone: null, status: null })} className="text-indigo-400 hover:text-indigo-300">Clear filter</button></div><div className="overflow-x-auto max-h-80"><table className="w-full min-w-[980px] text-xs border-collapse"><thead><tr className="text-left"><th className="py-3 px-4">Rack Zone</th><th className="py-3 px-4">Rack ID</th><th className="py-3 px-4">Status</th><th className="py-3 px-4">Cabinet Size</th><th className="py-3 px-4">Detail</th><th className="py-3 px-4">Device Type</th><th className="py-3 px-4">Remarks</th></tr></thead><tbody>{detailRecords.map((record: RackRecord) => <tr key={`${record.rowNumber}-${record.rackId ?? "blank"}`} className="border-t border-slate-800"><td className="py-2 px-4">{record.rackZone ?? "—"}</td><td className="py-2 px-4">{record.rackId ?? "—"}</td><td className="py-2 px-4">{record.status ?? "—"}</td><td className="py-2 px-4">{record.cabinetSize ?? "—"}</td><td className="py-2 px-4">{record.detail ?? "—"}</td><td className="py-2 px-4">{record.deviceType ?? "—"}</td><td className="py-2 px-4">{record.remarks ?? "—"}</td></tr>)}</tbody></table></div></div>}
        </>
      )}
    </section>
  );
}
