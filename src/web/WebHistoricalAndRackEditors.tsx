import { useEffect, useMemo, useState } from "react";
import { Save, Search } from "lucide-react";
import HistoricalCharts from "../components/HistoricalCharts";
import HistoricalExplorer from "../components/HistoricalExplorer";
import RackCapacityHistoryPanel from "../components/rack/RackCapacityHistoryPanel";
import { CapacityAlerts } from "../components/rack/CapacityAlerts";
import { CapacityGauge } from "../components/rack/CapacityGauge";
import { ExecutiveKpiCards } from "../components/rack/ExecutiveKpiCards";
import { Forecast } from "../components/rack/Forecast";
import { RackCapacityProvider } from "../components/rack/RackCapacityContext";
import RackCapacitySummaryCard from "../components/rack/RackCapacitySummaryCard";
import { StickyHeader as RackCapacityStickyHeader } from "../components/rack/StickyHeader";
import { Timeline as RackCapacityTimeline } from "../components/rack/Timeline";
import type { RackCapacitySummary, RackRecord } from "../reports/reportTypes";
import type { UpsGroupHistoryReport } from "../reports/reportTypes";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { apiRequest, ApiError } from "./apiClient";
import type { MonthlyLog } from "../types";
import { RACK_CANONICAL_STATUSES } from "../utils/rackCapacity";

interface HistoricalResponse {
  site: { id: number; code: string; name: string };
  displayPeriod: { startMonth: string; endMonth: string };
  logs: MonthlyLog[];
  upsGroupHistory: UpsGroupHistoryReport;
  rackCapacityHistory: any[];
  rackUnitCapacity: any[];
}

interface RackSnapshot {
  month: string;
  rowVersion: number;
  records: Array<Record<string, any>>;
  metrics?: any;
}

interface RackPageData {
  siteId: number;
  month: string;
  snapshot: RackSnapshot | null;
}

interface RackUnitPageData {
  siteId: number;
  month: string;
  snapshot: { rowVersion: number; totalU: number; usedU: number; availableU?: number; usagePercent?: number | null } | null;
  image?: { contentType: string; width: number; height: number; savedBy: string } | null;
}

interface RackSurfaceHistory {
  site: { id: number; name: string };
  rackCapacityHistory: RackCapacityHistoryRow[];
  rackUnitCapacity: RackUnitCapacityRow[];
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}

export function WebHistoricalPage({ siteId, onEditMonth }: { siteId: number; onEditMonth: (month: string) => void }) {
  const [data, setData] = useState<HistoricalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setError(null);
    if (!siteId) return;
    void apiRequest<HistoricalResponse>(`/historical?siteId=${encodeURIComponent(String(siteId))}`).then(setData).catch(cause => setError(errorText(cause, "Historical data could not be loaded.")));
  }, [siteId]);
  if (error) return <section role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5">{error}</section>;
  if (!data) return <LoadingHistory />;
  return <section className="space-y-6" data-testid="web-historical-logs"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Historical Logs</p><h1 className="text-3xl font-semibold mt-2">Historical Operations Explorer</h1><p className="text-sm text-slate-400 mt-2">Desktop-aligned historical charts, subsystem records, filters and month edit actions for {data.site.name}.</p></div><HistoricalCharts logs={data.logs} lang="en" displayPeriod="all" /><HistoricalExplorer logs={data.logs} lang="en" upsGroupHistory={data.upsGroupHistory} activeFacilityId={data.site.code} rackCapacityHistory={data.rackCapacityHistory} rackUnitCapacity={data.rackUnitCapacity} displayPeriod="all" onEditMonth={onEditMonth} /></section>;
}

function LoadingHistory() { return <section className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400">Loading historical logsâ€¦</section>; }

export function WebRackCapacityEditor({ data, readOnly, onSaved }: { data: RackPageData; readOnly: boolean; onSaved: () => void }) {
  const [records, setRecords] = useState<Array<Record<string, any>>>([]);
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setRecords(data.snapshot?.records?.map(record => ({ ...record })) ?? []), [data.snapshot]);
  const zones = useMemo(() => [...new Set(records.map(record => record.rackZone).filter(Boolean))].sort(), [records]);
  const visible = records.map((record, index) => ({ record, index })).filter(({ record }) => (!zone || record.rackZone === zone) && (!query || String(record.rackId ?? "").toLowerCase().includes(query.toLowerCase())));
  const update = (index: number, field: string, value: string) => setRecords(current => current.map((record, candidate) => candidate === index ? { ...record, [field]: value === "" ? null : value } : record));
  const save = async () => {
    if (!data.snapshot || saving || readOnly) return;
    setSaving(true); setMessage(null);
    try { await apiRequest(`/sites/${data.siteId}/rack-snapshots/${data.month}`, { method: "PUT", body: JSON.stringify({ expected_row_version: data.snapshot.rowVersion, records }) }); setMessage("Rack Capacity saved and monthly history snapshot recorded."); onSaved(); }
    catch (cause) { setMessage(errorText(cause, "Rack Capacity could not be saved.")); }
    finally { setSaving(false); }
  };
  if (!data.snapshot) return <section className="panel text-sm text-slate-400">Rack Capacity data is unavailable for this month.</section>;
  return <section className="panel space-y-4" data-testid="web-rack-capacity-editor"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Rack Capacity Editor</h2><p className="text-xs text-slate-500 mt-1">Desktop-aligned staged row editing with optimistic concurrency.</p></div><button type="button" disabled={readOnly || saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-2 text-sm font-semibold"><Save className="w-4 h-4" />{saving ? "Savingâ€¦" : "Save Changes"}</button></div><div className="grid sm:grid-cols-2 gap-3"><label className="text-xs text-slate-400">Rack Zone<select value={zone} onChange={event => setZone(event.target.value)} className="field mt-1 w-full"><option value="">All zones</option>{zones.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label className="text-xs text-slate-400">Rack ID<div className="relative mt-1"><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} className="field w-full pl-9" placeholder="Search rack ID" /></div></label></div>{message && <p role="status" className="text-sm text-slate-300">{message}</p>}<div className="overflow-x-auto max-h-[32rem]"><table className="min-w-[1100px] w-full text-xs"><thead className="sticky top-0 bg-slate-950 text-left text-slate-400"><tr>{["Zone", "Rack ID", "Status", "Cabinet Size", "Detail", "Device Type", "Remarks"].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{visible.map(({ record, index }) => <tr key={`${record.rowNumber ?? index}-${record.rackId ?? "rack"}`}><td className="px-3 py-2">{record.rackZone ?? "â€”"}</td><td className="px-3 py-2 font-mono">{record.rackId ?? "â€”"}</td><td className="px-3 py-2"><select value={record.status ?? ""} disabled={readOnly} onChange={event => update(index, "status", event.target.value)} className="field"><option value="">â€”</option>{RACK_CANONICAL_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}</select></td>{["cabinetSize", "detail", "deviceType", "remarks"].map(field => <td key={field} className="px-3 py-2"><input disabled={readOnly} value={record[field] ?? ""} onChange={event => update(index, field, event.target.value)} className="field min-w-[150px]" /></td>)}</tr>)}</tbody></table></div></section>;
}

/**
 * Web Rack Capacity surface backed by the same Desktop presentation
 * components and RackCapacityContext. The Web editor remains a server API
 * editor, but all executive KPIs, health bands, forecast math, zone summary,
 * timeline and persisted history are rendered by the Desktop components so
 * the two surfaces cannot drift through duplicate calculations.
 */
export function WebRackCapacitySurface({
  data,
  readOnly,
  refreshKey,
  onSaved
}: {
  data: RackPageData;
  readOnly: boolean;
  refreshKey: number;
  onSaved: () => void;
}) {
  const [history, setHistory] = useState<RackSurfaceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setHistory(null);
    setError(null);
    void apiRequest<RackSurfaceHistory>(`/historical?siteId=${encodeURIComponent(String(data.siteId))}`)
      .then(result => { if (active) setHistory(result); })
      .catch(cause => { if (active) setError(errorText(cause, "Rack Capacity history could not be loaded.")); });
    return () => { active = false; };
  }, [data.siteId, refreshKey]);

  if (error) return <section role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5">{error}</section>;
  if (!history) return <LoadingHistory />;
  if (!data.snapshot) return <section className="panel text-sm text-slate-400">Rack Capacity data is unavailable for this month.</section>;

  const metrics = data.snapshot.metrics;
  const rackCapacity: RackCapacitySummary = {
    totalRacks: metrics?.total ?? data.snapshot.records.length,
    records: data.snapshot.records as RackRecord[],
    byStatus: Object.entries(metrics?.countsByStatus ?? {}).map(([status, count]) => ({ status, count: Number(count) })),
    byZone: (metrics?.zoneMetrics ?? []).map((zone: { zone: string; total: number }) => ({ zone: zone.zone, count: zone.total }))
  };

  return (
    <RackCapacityProvider
      lang="en"
      facilityName={history.site.name}
      initialReportingMonth={data.month}
      rackCapacity={rackCapacity}
      rackUnitCapacity={history.rackUnitCapacity}
      rackCapacityHistory={history.rackCapacityHistory}
    >
      <div className="space-y-6" data-testid="web-rack-capacity-surface">
        <RackCapacityStickyHeader />
        <RackCapacityTimeline />
        <CapacityAlerts />
        <ExecutiveKpiCards />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CapacityGauge />
          <Forecast />
        </div>
        <RackCapacitySummaryCard />
        <RackCapacityHistoryPanel />
        <WebRackCapacityEditor data={data} readOnly={readOnly} onSaved={onSaved} />
      </div>
    </RackCapacityProvider>
  );
}

export function WebRackUnitEditor({ data, readOnly, onSaved }: { data: RackUnitPageData; readOnly: boolean; onSaved: () => void }) {
  const [totalU, setTotalU] = useState("");
  const [usedU, setUsedU] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setTotalU(data.snapshot ? String(data.snapshot.totalU) : ""); setUsedU(data.snapshot ? String(data.snapshot.usedU) : ""); }, [data.snapshot, data.month]);
  const save = async () => {
    if (saving || readOnly) return;
    const total = Number(totalU); const used = Number(usedU);
    if (!Number.isFinite(total) || !Number.isFinite(used) || total < 0 || used < 0) { setMessage("Total (U) and Used (U) must be non-negative numbers."); return; }
    setSaving(true); setMessage(null);
    try {
      await apiRequest(`/sites/${data.siteId}/rack-unit-snapshots/${data.month}`, { method: "PUT", body: JSON.stringify({ total_u: total, used_u: used, expected_row_version: data.snapshot?.rowVersion ?? null }) });
      setMessage("Rack Unit Capacity saved."); onSaved();
    } catch (cause) { setMessage(errorText(cause, "Rack Unit Capacity could not be saved.")); }
    finally { setSaving(false); }
  };
  const available = Number(totalU) - Number(usedU);
  const ratio = Number(totalU) > 0 ? (available / Number(totalU)) * 100 : null;
  return <section className="panel space-y-4" data-testid="web-rack-unit-editor"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Rack Unit Capacity</h2><p className="text-xs text-slate-500 mt-1">Desktop-aligned monthly Total/Used values.</p></div><button type="button" disabled={readOnly || saving} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-2 text-sm font-semibold"><Save className="w-4 h-4" />{saving ? "Savingâ€¦" : "Save Changes"}</button></div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><label className="text-xs text-slate-400">Total (U)<input type="number" min={0} disabled={readOnly} value={totalU} onChange={event => setTotalU(event.target.value)} className="field mt-1 w-full" /></label><label className="text-xs text-slate-400">Used (U)<input type="number" min={0} disabled={readOnly} value={usedU} onChange={event => setUsedU(event.target.value)} className="field mt-1 w-full" /></label><div className="text-xs text-slate-400">Available (U)<p className="text-lg text-slate-100 mt-2">{Number.isFinite(available) ? available : "â€”"}</p></div><div className="text-xs text-slate-400">Availability<p className="text-lg text-slate-100 mt-2">{ratio === null ? "â€”" : `${ratio.toFixed(2)}%`}</p></div></div>{message && <p role="status" className="text-sm text-slate-300">{message}</p>}</section>;
}
