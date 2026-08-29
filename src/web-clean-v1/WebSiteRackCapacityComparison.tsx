import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { BarChart3, Building2, RefreshCw, Search, Server, ShieldCheck, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { calculateRackCapacityMetrics, rackUtilizationLevel } from "../domain/rackCapacity";
import { isValidRackUnitCapacity, rackAvailabilityStatus, rackCountsReconcile, type RackAvailabilityStatus } from "../domain/rackComparison";
import { usagePercent } from "../domain/rackUnitCapacity";
import { formatFixedNumber, formatFixedPercentage } from "../utils/numberFormat";
import { monthLabelLong } from "../utils/monthUtils";
import { formatRackCabinetSize } from "../utils/rackCapacity";
import { api } from "./api";
import { loadRackCapacitySnapshot } from "./rackCapacityData";
import type { RackApiSnapshot, RackUnitApiSnapshot } from "./WebRackCapacityEditors";

type SiteRef = { id: number; code: string; name: string };
type SiteComparisonState = {
  site: SiteRef;
  rack: RackApiSnapshot | null;
  rackError: boolean;
  unit: RackUnitApiSnapshot | null;
  unitError: boolean;
};
type RackPositionStatus = "Available" | "Reserved" | "Pending Decommission";
type RackPosition = {
  siteId: number;
  siteName: string;
  zone: string;
  rackId: string | null;
  cabinetSize: string | null;
  detail: string | null;
  status: RackPositionStatus;
};

const RACK_POSITION_STATUSES: readonly RackPositionStatus[] = ["Available", "Reserved", "Pending Decommission"];

const statusClass: Record<RackAvailabilityStatus | "Unavailable" | "Normal" | "Attention" | "High", string> = {
  Ready: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
  Limited: "border-amber-400/50 bg-amber-400/10 text-amber-300",
  Full: "border-rose-400/50 bg-rose-400/10 text-rose-300",
  Normal: "border-emerald-400/50 bg-emerald-400/10 text-emerald-300",
  Attention: "border-amber-400/50 bg-amber-400/10 text-amber-300",
  High: "border-amber-400/50 bg-amber-400/10 text-amber-300",
  Unavailable: "border-slate-600 bg-slate-800/70 text-slate-400"
};

const statusBorder: Record<RackAvailabilityStatus, string> = {
  Ready: "#60a5fa",
  Limited: "#fb923c",
  Full: "#f87171"
};

function sortSites(left: SiteRef, right: SiteRef): number {
  return left.name.localeCompare(right.name) || left.id - right.id;
}

export function displayPositionStatus(status: string | null): RackPositionStatus | null {
  if (status === "Available" || status === "Reserved") return status;
  if (status === "Pending Dismantle") return "Pending Decommission";
  return null;
}

export function rackPositionRows(site: SiteRef, snapshot: RackApiSnapshot | null): RackPosition[] {
  if (!snapshot) return [];
  return snapshot.records.flatMap(record => {
    const status = displayPositionStatus(record.status);
    if (!status) return [];
    return [{
      siteId: site.id,
      siteName: site.name,
      zone: record.rackZone ?? "(blank)",
      rackId: record.rackId,
      cabinetSize: record.cabinetSize,
      detail: record.detail,
      status
    } satisfies RackPosition];
  });
}

function rackPositions(state: SiteComparisonState): RackPosition[] {
  return rackPositionRows(state.site, state.rack);
}

export function filterRackPositions(rows: readonly RackPosition[], query: string, zone: string, status: RackPositionStatus | ""): RackPosition[] {
  const needle = query.trim().toLowerCase();
  return rows.filter(row => (!needle || (row.rackId ?? "").toLowerCase().includes(needle)) && (!zone || row.zone === zone) && (!status || row.status === status));
}

function StatusBadge({ status }: { status: RackAvailabilityStatus | "Unavailable" | "Normal" | "Attention" | "High" }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${statusClass[status]}`}>{status}</span>;
}

function Metric({ label, value, className = "text-slate-200", bordered = false }: { label: string; value: string; className?: string; bordered?: boolean }) {
  return <div className={`min-w-0 ${bordered ? "border-l border-slate-800 pl-3" : ""}`}><p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p><p className={`mt-1 font-mono text-sm font-semibold ${className}`}>{value}</p></div>;
}

function unavailableText(site: SiteComparisonState, month: string, dataset: "Rack" | "Rack Unit"): string {
  if (dataset === "Rack") return `${site.rackError ? "Rack data could not be loaded" : "No monthly Rack Capacity snapshot"} for ${site.site.name} — ${monthLabelLong(month, "en")}.`;
  return `${site.unitError ? "Rack Unit data could not be loaded" : "No monthly Rack Unit Capacity snapshot"} for ${site.site.name} — ${monthLabelLong(month, "en")}.`;
}

function rackUnitUnavailableText(site: SiteComparisonState, month: string): string {
  if (site.unitError) return `Rack Unit data could not be loaded for ${site.site.name} — ${monthLabelLong(month, "en")}.`;
  if (!site.unit) return `No monthly Rack Unit Capacity snapshot for ${site.site.name} — ${monthLabelLong(month, "en")}.`;
  return `Rack Unit Capacity snapshot for ${site.site.name} — ${monthLabelLong(month, "en")} contains invalid non-negative values. It is excluded from the comparison bars.`;
}


const SiteSummaryCard: FC<{ state: SiteComparisonState; month: string }> = ({ state, month }) => {
  const metrics = state.rack ? calculateRackCapacityMetrics(state.rack.records) : null;
  const availability = metrics && metrics.total > 0 ? (metrics.available.count / metrics.total) * 100 : null;
  const status = metrics ? rackAvailabilityStatus(metrics.available.count, metrics.total) : null;
  const availabilityRatio = availability === null ? 0 : Math.max(0, Math.min(100, availability));
  const gaugeStyle = { background: "conic-gradient(var(--color-emerald-400) " + availabilityRatio * 3.6 + "deg, var(--color-slate-800) 0deg)" };
  return <article className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm" style={{ borderColor: status ? statusBorder[status] + "80" : undefined }} data-testid={"rack-comparison-site-" + state.site.id}>
    {!metrics ? <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-300"><Building2 className="h-5 w-5" /></div><div><h3 className="font-display text-lg font-bold text-slate-100">{state.site.name}</h3><p className="mt-0.5 text-xs text-slate-500">{state.site.code}</p></div></div><StatusBadge status="Unavailable" /></div> : <>
      <div className="grid gap-4 md:grid-cols-[minmax(10rem,0.9fr)_8.5rem_minmax(0,1.1fr)] md:items-center">
        <div className="flex min-h-32 flex-col items-center justify-center border-b border-slate-800 pb-4 text-center md:border-b-0 md:border-r md:pb-0 md:pr-4"><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-indigo-300" /><h3 className="font-display text-xl font-bold text-slate-100">{state.site.name}</h3></div><p className="mt-1 text-xs uppercase tracking-[0.12em] text-slate-500">{state.site.code}</p><p className="mt-3 text-[10px] uppercase tracking-[0.16em] text-slate-500">Available Rack Positions</p></div>
        <div className="flex flex-col items-center justify-center"><div className="relative grid h-28 w-28 place-items-center rounded-full" style={gaugeStyle} aria-label={formatFixedNumber(metrics.available.count, 0) + " available racks"}><div className="grid h-20 w-20 place-items-center rounded-full bg-slate-900 text-center"><p className="font-mono text-4xl font-semibold text-emerald-300">{formatFixedNumber(metrics.available.count, 0)}</p><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">racks</p></div></div><p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Available Now</p></div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-4"><Metric label="Total Racks" value={formatFixedNumber(metrics.total, 0)} /><Metric label="In Use" value={formatFixedNumber(metrics.inUse.count, 0)} bordered /><Metric label="Reserved" value={formatFixedNumber(metrics.reserved.count, 0)} className="text-sky-300" bordered /><Metric label="Pending Decommission" value={formatFixedNumber(metrics.pendingDismantle.count, 0)} className="text-amber-300" bordered /></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-800 pt-3"><Metric label="Availability %" value={formatFixedPercentage(availability, 1)} className="text-emerald-300" /><div className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Status</span><StatusBadge status={status ?? "Unavailable"} /></div></div>
      {metrics.other.count > 0 && <p className="mt-3 text-xs text-amber-200">Other statuses: <span className="font-mono">{formatFixedNumber(metrics.other.count, 0)}</span>. Included in total reconciliation.</p>}
    </>}
    {!metrics && <p className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-4 text-sm leading-relaxed text-amber-200">{unavailableText(state, month, "Rack")}</p>}
  </article>;
};

function ZoneAvailability({ states, month }: { states: SiteComparisonState[]; month: string }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5" aria-label="Available Rack Positions by Zone" data-testid="rack-comparison-zone-availability">
    <div className="mb-4 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-indigo-300" /><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Available Rack Positions by Zone</h3></div>
    <div className="grid gap-5 lg:grid-cols-2">{states.map(state => {
      const metrics = state.rack ? calculateRackCapacityMetrics(state.rack.records) : null;
      return <div key={state.site.id} className="min-w-0"><p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-sky-300">{state.site.name}</p>{!metrics ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-amber-200">{unavailableText(state, month, "Rack")}</p> : metrics.zoneMetrics.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-500">No rack zones exist for this month.</p> : <div className="space-y-3">{metrics.zoneMetrics.map(zone => { const percent = zone.total > 0 ? (zone.available.count / zone.total) * 100 : 0; return <div key={zone.zone} className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,1.2fr)_auto] items-center gap-3"><span className="truncate text-sm text-slate-300">{state.site.name} / {zone.zone}</span><div className="h-3 overflow-hidden rounded-sm border border-slate-700 bg-slate-950"><div className="h-full rounded-sm bg-emerald-400" style={{ width: Math.max(0, Math.min(100, percent)) + "%" }} /></div><span className="whitespace-nowrap font-mono text-sm text-emerald-300">{formatFixedNumber(zone.available.count, 0)} racks <StatusBadge status={rackAvailabilityStatus(zone.available.count, zone.total)} /></span></div>; })}</div>}</div>;
    })}</div>
    {states.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No active Sites are available for comparison.</p>}
  </section>;
}

function TotalAvailable({ states }: { states: SiteComparisonState[] }) {
  const rows: Array<{ name: string; value: number }> = states.flatMap(state => { const metrics = state.rack ? calculateRackCapacityMetrics(state.rack.records) : null; return metrics ? [{ name: state.site.name, value: metrics.available.count }] : []; });
  const maximum = Math.max(1, ...rows.map(row => row.value));
  const leader = [...rows].sort((left, right) => right.value - left.value || left.name.localeCompare(right.name))[0];
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5" aria-label="Total Available Rack Positions" data-testid="rack-comparison-total-available">
    <div className="grid gap-5 lg:grid-cols-[10rem_minmax(0,1fr)_14rem] lg:items-center"><div className="flex items-center gap-3"><div className="rounded-lg border border-sky-400/40 p-2 text-sky-300"><BarChart3 className="h-5 w-5" /></div><h3 className="font-display text-base font-bold text-slate-200">Total Available</h3></div><div className="space-y-3">{rows.length === 0 ? <p className="text-sm text-slate-500">No Rack Capacity snapshots are available for this Reporting Month.</p> : rows.map(row => <div key={row.name} className="grid grid-cols-[5rem_minmax(0,1fr)_4rem] items-center gap-3"><span className="text-sm text-slate-300">{row.name}</span><div className="h-3 overflow-hidden rounded-sm bg-slate-800"><div className="h-full rounded-sm bg-emerald-400" style={{ width: row.value / maximum * 100 + "%" }} /></div><span className="font-mono text-sm text-emerald-300">{formatFixedNumber(row.value, 0)} racks</span></div>)}</div>{leader && <div className="border-l border-slate-800 pl-5 text-sm text-slate-300 lg:border-l"><span className="text-emerald-300">{leader.name}</span> has <span className="font-semibold text-emerald-300">{formatFixedNumber(leader.value, 0)}</span> available rack positions.</div>}</div>
  </section>;
}

function RackPositions({ states, month }: { states: SiteComparisonState[]; month: string }) {
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<RackPositionStatus | "">("");
  useEffect(() => { setQuery(""); setZoneFilter(""); setStatusFilter(""); }, [month]);
  const allRows = useMemo<RackPosition[]>(() => states.flatMap(rackPositions), [states]);
  const zones = useMemo<string[]>(() => Array.from(new Set(allRows.map(row => row.zone))).sort((left: string, right: string) => left.localeCompare(right)), [allRows]);
  const filtered = useMemo(() => filterRackPositions(allRows, query, zoneFilter, statusFilter), [allRows, query, statusFilter, zoneFilter]);
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-3 sm:p-5" aria-label="Rack Positions" data-testid="rack-comparison-positions">
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3"><label className="relative min-w-0 flex-1 sm:min-w-52"><span className="sr-only">Search Rack ID</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Rack ID" className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100" /></label><label className="flex min-w-36 flex-1 items-center gap-2 text-xs text-slate-400"><span className="sr-only">Zone</span><select value={zoneFilter} onChange={event => setZoneFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="">All Zones</option>{zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label><label className="flex min-w-40 flex-1 items-center gap-2 text-xs text-slate-400"><span className="sr-only">Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as RackPositionStatus | "")} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="">All Statuses</option>{RACK_POSITION_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}</select></label><button type="button" onClick={() => { setQuery(""); setZoneFilter(""); setStatusFilter(""); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-sky-400"><X className="h-3.5 w-3.5" />Clear Filters</button></div>
    <div className="mb-4 flex items-center gap-2"><Server className="h-4 w-4 text-sky-300" /><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Rack Positions</h3><span className="text-xs text-slate-500">{filtered.length} deployment-relevant rows</span></div>
    <div className="grid gap-5 xl:grid-cols-2">{states.map(state => {
      const rows = filtered.filter(row => row.siteId === state.site.id);
      return <article key={state.site.id} className="min-w-0" data-testid={"rack-positions-site-" + state.site.id}><h4 className="mb-3 flex items-center gap-2 font-display text-sm font-bold text-slate-200"><Building2 className="h-4 w-4 text-sky-300" />{state.site.name} Rack Positions</h4>{!state.rack ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm leading-relaxed text-amber-200">No confirmed Rack Capacity snapshot for {state.site.name} — {monthLabelLong(month, "en")}.</p> : <div className="grid gap-3 md:grid-cols-3">{RACK_POSITION_STATUSES.map(status => { const statusRows = rows.filter(row => row.status === status); return <section key={status} className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/30 p-3" data-testid={"rack-positions-" + state.site.id + "-" + status.toLowerCase().replaceAll(" ", "-")}><div className="mb-3 flex items-center justify-between gap-2"><h5 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">{status}</h5><span className="font-mono text-xs text-slate-400">{statusRows.length}</span></div>{statusRows.length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No {status.toLowerCase()} rack positions.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[300px] border-collapse text-xs"><thead className="text-left text-[10px] uppercase tracking-wider text-slate-500"><tr><th scope="col" className="border-b border-slate-800 px-2 py-2">Rack ID</th><th scope="col" className="border-b border-slate-800 px-2 py-2">Cabinet Size (cm)</th><th scope="col" className="border-b border-slate-800 px-2 py-2">Detail</th></tr></thead><tbody>{statusRows.map(row => <tr key={row.siteId + "-" + row.status + "-" + (row.rackId ?? "blank")} className="border-b border-slate-800/70 last:border-0"><th scope="row" className="whitespace-nowrap px-2 py-2 font-mono font-medium text-sky-300">{row.rackId ?? "—"}</th><td className="whitespace-nowrap px-2 py-2 text-slate-300">{formatRackCabinetSize(row.cabinetSize)}</td><td className="px-2 py-2 text-slate-400">{row.detail ?? "—"}</td></tr>)}</tbody></table></div>}</section>; })}</div>}</article>;
    })}</div>
    {states.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No active Sites are available for comparison.</p>}
  </section>;
}

function rackUnitTooltip(value: number | string | undefined, name: string | undefined): [string, string] {
  const numberValue = typeof value === "number" ? value : Number(value);
  return [Number.isFinite(numberValue) ? `${formatFixedNumber(numberValue, 1)} U` : "—", name ?? "Rack Units"];
}

function RackUnitComparison({ states, month }: { states: SiteComparisonState[]; month: string }) {
  const rows = states.flatMap(state => {
    const snapshot = state.unit;
    if (!snapshot || !isValidRackUnitCapacity(snapshot.totalU, snapshot.usedU)) return [];
    const usage = usagePercent(snapshot);
    return [{ state, snapshot, available: snapshot.totalU - snapshot.usedU, usage, status: usage === null ? "Unavailable" as const : rackUtilizationLevel(usage) }];
  });
  const unavailable = states.filter(state => !state.unit || !isValidRackUnitCapacity(state.unit.totalU, state.unit.usedU));
  const maximum = Math.max(1, ...rows.map(row => row.snapshot.totalU)) * 1.12;
  const chartRows = rows.map(row => ({
    site: row.state.site.name,
    used: row.snapshot.usedU,
    available: row.available,
    usedLabel: `Used ${formatFixedNumber(row.snapshot.usedU, 1)} U`,
    availableLabel: `Available ${formatFixedNumber(row.available, 1)} U`,
    totalLabel: `Total ${formatFixedNumber(row.snapshot.totalU, 1)} U`
  }));
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5" aria-label="Rack Unit Capacity Comparison" data-testid="site-rack-unit-capacity-comparison">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 text-blue-300" /><div><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Rack Unit Capacity Comparison</h3><p className="mt-1 text-xs text-slate-400">Used and available rack units by site — {monthLabelLong(month, "en")}</p></div></div><p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Utilization</p></div>
    {chartRows.length === 0 ? <p className="mt-5 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No valid Rack Unit Capacity snapshots are available for this Reporting Month.</p> : <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_110px]">
      <div className="h-[330px] min-w-0" role="img" aria-label="Horizontal stacked bars comparing used and available rack units by site"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows} layout="vertical" margin={{ top: 8, right: 104, left: 8, bottom: 48 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" /><XAxis type="number" domain={[0, maximum]} tickCount={6} tickFormatter={value => formatFixedNumber(Number(value), 1)} label={{ value: "Rack Units (U)", position: "insideBottom", offset: -28, fill: "#94a3b8", fontSize: 12 }} /><YAxis type="category" dataKey="site" width={94} stroke="#94a3b8" tick={{ fontSize: 12 }} /><Tooltip formatter={rackUnitTooltip} contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} /><Bar dataKey="used" stackId="capacity" name="Used U" fill="#e94b1b" isAnimationActive={false}><LabelList dataKey="usedLabel" position="center" fill="#fff7ed" fontSize={11} /></Bar><Bar dataKey="available" stackId="capacity" name="Available U" fill="#22c55e" radius={[0, 5, 5, 0]} isAnimationActive={false}><LabelList dataKey="availableLabel" position="center" fill="#ecfdf5" fontSize={11} /><LabelList dataKey="totalLabel" position="right" fill="#e2e8f0" fontSize={11} /></Bar><Legend verticalAlign="bottom" height={32} /></BarChart></ResponsiveContainer></div>
      <div className="hidden flex-col justify-around gap-3 pb-12 md:flex">{rows.map(row => <div key={row.state.site.id} className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-3 text-right"><p className="font-mono text-lg font-semibold text-slate-100">{formatFixedPercentage(row.usage, 1)}</p><span className={`mt-1 inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${statusClass[row.status]}`}>{row.status}</span></div>)}</div>
      <div className="grid gap-3 md:hidden">{rows.map(row => <div key={row.state.site.id} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2"><span className="text-xs text-slate-400">{row.state.site.name}</span><span className="flex items-center gap-2"><b className="font-mono text-slate-100">{formatFixedPercentage(row.usage, 1)}</b><StatusBadge status={row.status} /></span></div>)}</div>
    </div>}
    {unavailable.length > 0 && <div className="mt-5 space-y-1 text-xs text-amber-200">{unavailable.map(state => <p key={state.site.id}>{rackUnitUnavailableText(state, month)}</p>)}</div>}
    <p className="mt-5 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs leading-relaxed text-slate-400">Note: Available U represents physical rack space only; actual deployment capacity depends on power, cooling, weight, and contiguous space availability.</p>
  </section>;
}

export default function WebSiteRackCapacityComparison({ month, activePeriodLabel }: { month: string; activePeriodLabel?: string }) {
  const [states, setStates] = useState<SiteComparisonState[] | null>(null);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true); setError(null);
    try {
      const sites = (await api<SiteRef[]>("/sites")).sort(sortSites);
      const next = await Promise.all(sites.map(async site => {
        const [rackResult, unitResult] = await Promise.allSettled([
          loadRackCapacitySnapshot(site.id, month),
          api<{ snapshot: RackUnitApiSnapshot | null }>("/rack-unit-capacity?siteId=" + site.id + "&month=" + encodeURIComponent(month))
        ]);
        return {
          site,
          // Candidate/carry-forward data is an Entry draft, not a confirmed
          // monthly snapshot; comparison must remain exact and read-only.
          rack: rackResult.status === "fulfilled" && rackResult.value.persisted ? rackResult.value.snapshot : null,
          rackError: rackResult.status === "rejected",
          unit: unitResult.status === "fulfilled" ? unitResult.value.snapshot : null,
          unitError: unitResult.status === "rejected"
        } satisfies SiteComparisonState;
      }));
      if (generation !== requestGeneration.current) return;
      setStates(next);
      setLoadedMonth(month);
    } catch (reason) {
      if (generation !== requestGeneration.current) return;
      setError(reason instanceof Error ? reason.message : "Site Rack Capacity Comparison could not be loaded.");
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [month]);
  useEffect(() => {
    void load();
    return () => { requestGeneration.current += 1; };
  }, [load]);

  const rackMetrics = useMemo(() => (states ?? []).map((state, siteOrder) => ({ state, siteOrder, metrics: state.rack ? calculateRackCapacityMetrics(state.rack.records) : null })), [states]);
  const unavailableRackSites = (states ?? []).filter(state => !state.rack);
  const reconciliationMetrics = rackMetrics.flatMap(({ metrics }) => metrics ? [metrics] : []);
  const allRackSnapshotsReconcile = reconciliationMetrics.every(rackCountsReconcile);

  const currentMonthLoaded = loadedMonth === month;
  if (loading && !currentMonthLoaded) return <section role="status" className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">Loading Site Rack Capacity Comparison…</section>;
  if (error && !currentMonthLoaded) return <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100">{error}</section>;
  const sites = currentMonthLoaded ? states ?? [] : [];
  return <section className="space-y-5" data-testid="web-site-rack-capacity-comparison">
    <header className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-300"><Server className="h-5 w-5" /></div><div><h2 className="font-display text-2xl font-bold tracking-tight text-slate-100">Site Rack Capacity &amp; Availability Comparison</h2><p className="mt-1 text-sm text-slate-400">Available rack positions by site and zone for deployment planning.</p><p className="mt-2 text-xs uppercase tracking-wide text-slate-500">Reporting period: <span className="font-mono text-slate-300">{activePeriodLabel ?? monthLabelLong(month, "en")}</span></p></div></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-teal-500"><RefreshCw className="h-4 w-4" />Refresh</button></div></header>
    {error && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">Some comparison data could not be loaded; unavailable Sites remain excluded from totals and planning views.</p>}
    <div className="grid gap-4 lg:grid-cols-2">{sites.map(state => <SiteSummaryCard key={state.site.id} state={state} month={month} />)}</div>
    {sites.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No active Sites are available for comparison.</p>}
    <ZoneAvailability states={sites} month={month} />
    <TotalAvailable states={sites} />
    <RackPositions states={sites} month={month} />
    {!allRackSnapshotsReconcile && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">Rack status totals require review before this comparison is used for planning.</p>}
    {unavailableRackSites.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-100"><p className="font-semibold">Rack Capacity unavailable</p>{unavailableRackSites.map(state => <p key={state.site.id} className="mt-1">{unavailableText(state, month, "Rack")} Excluded from totals and planning views.</p>)}</div>}
    <RackUnitComparison states={sites} month={month} />
  </section>;
}
