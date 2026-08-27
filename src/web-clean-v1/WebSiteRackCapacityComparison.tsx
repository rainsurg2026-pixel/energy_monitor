import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { BarChart3, Building2, Crosshair, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { calculateRackCapacityMetrics, rackUtilizationLevel } from "../domain/rackCapacity";
import { isValidRackUnitCapacity, rackAvailabilityStatus, rackCountsReconcile, rankRackLocations, type RackAvailabilityStatus } from "../domain/rackComparison";
import { usagePercent } from "../domain/rackUnitCapacity";
import { formatFixedNumber, formatFixedPercentage } from "../utils/numberFormat";
import { monthLabelLong } from "../utils/monthUtils";
import { api } from "./api";
import type { RackSnapshotApiResponse } from "./exports";
import type { RackUnitApiSnapshot } from "./WebRackCapacityEditors";

type SiteRef = { id: number; code: string; name: string };
type RackSnapshot = NonNullable<RackSnapshotApiResponse["snapshot"]>;
type SiteComparisonState = {
  site: SiteRef;
  rack: RackSnapshot | null;
  rackError: boolean;
  unit: RackUnitApiSnapshot | null;
  unitError: boolean;
};
type RackRow = {
  siteId: number;
  siteName: string;
  siteOrder: number;
  zone: string;
  total: number;
  inUse: number;
  available: number;
  reserved: number;
  pendingDecommission: number;
  other: number;
};
type RackSiteTotal = { siteId: number; siteName: string; available: number };

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
  return <article className="rounded-2xl border bg-[#111c31] p-4 shadow-sm" style={{ borderColor: status ? `${statusBorder[status]}80` : "#334155" }} data-testid={`rack-comparison-site-${state.site.id}`}>
    {!metrics ? <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-300"><Building2 className="h-5 w-5" /></div><div><h3 className="font-display text-lg font-bold text-slate-100">{state.site.name}</h3><p className="mt-0.5 text-xs text-slate-500">{state.site.code}</p></div></div><StatusBadge status="Unavailable" /></div> : <>
      <div className="grid gap-4 md:grid-cols-[8rem_9rem_minmax(0,1fr)] md:items-center">
        <div className="flex min-h-28 flex-col items-center justify-center border-b border-slate-800 pb-3 text-center md:border-b-0 md:border-r md:pb-0 md:pr-4"><div className="flex items-center gap-2"><Building2 className="h-5 w-5 text-indigo-300" /><h3 className="font-display text-lg font-bold text-slate-100">{state.site.name}</h3></div><p className="mt-1 text-xs text-slate-500">{state.site.code}</p></div>
        <div className="text-center md:border-r md:border-slate-800 md:pr-4"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Available Now</p><p className="mt-1 font-mono text-4xl font-semibold text-emerald-300">{formatFixedNumber(metrics.available.count, 0)}</p><p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">Racks</p></div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-4"><Metric label="Total Racks" value={formatFixedNumber(metrics.total, 0)} /><Metric label="In Use" value={formatFixedNumber(metrics.inUse.count, 0)} bordered /><Metric label="Reserved" value={formatFixedNumber(metrics.reserved.count, 0)} className="text-blue-300" bordered /><Metric label="Pending Decommission" value={formatFixedNumber(metrics.pendingDismantle.count, 0)} className="text-amber-300" bordered /></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-800 pt-3"><Metric label="Availability %" value={formatFixedPercentage(availability, 1)} className="text-emerald-300" /><div className="flex items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Status</span><StatusBadge status={status ?? "Unavailable"} /></div></div>
      {metrics.other.count > 0 && <p className="mt-3 text-xs text-amber-200">Other statuses: <span className="font-mono">{metrics.other.count}</span>. Included in total reconciliation.</p>}
    </>}
    {!metrics && <p className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-950/30 p-4 text-sm leading-relaxed text-amber-200">{unavailableText(state, month, "Rack")}</p>}
  </article>;
};

function RackAvailabilityChart({ sites }: { sites: RackSiteTotal[] }) {
  const data = [...sites].sort((left, right) => right.available - left.available || left.siteName.localeCompare(right.siteName) || left.siteId - right.siteId).map(site => ({ site: site.siteName, available: site.available }));
  return <section className="rounded-2xl border border-slate-800 bg-[#0f1a2e] p-5" aria-label="Available Racks by Site">
    <div className="mb-4 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-emerald-300" /><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Available Racks by Site</h3></div>
    {data.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No Rack Capacity snapshots are available for this Reporting Month.</p> : <div className="h-[250px]" role="img" aria-label="Horizontal bar chart of available racks by site"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 8, right: 34, left: 8, bottom: 34 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" horizontal={false} /><XAxis type="number" allowDecimals={false} stroke="#64748b" label={{ value: "Available Racks", position: "insideBottom", offset: -20, fill: "#94a3b8", fontSize: 11 }} /><YAxis type="category" dataKey="site" width={94} stroke="#94a3b8" tick={{ fontSize: 11 }} /><Tooltip formatter={(value: number | string | undefined) => [`${value ?? "—"} racks`, "Available"]} contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} /><Bar dataKey="available" name="Available Racks" fill="#35d07f" radius={[0, 6, 6, 0]}><LabelList dataKey="available" position="right" fill="#d1fae5" fontSize={11} /></Bar></BarChart></ResponsiveContainer></div>}
  </section>;
}

function BestLocations({ rows }: { rows: RackRow[] }) {
  const ranked = rankRackLocations(rows.map(row => ({ siteId: row.siteId, siteName: row.siteName, siteOrder: row.siteOrder, zone: row.zone, available: row.available })));
  return <section className="rounded-2xl border border-slate-800 bg-[#0f1a2e] p-5" aria-label="Best Locations for New Rack Installation">
    <div className="mb-4 flex items-center gap-2"><Crosshair className="h-4 w-4 text-amber-300" /><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Best Locations for New Rack Installation</h3></div>
    {ranked.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No Rack locations are available for ranking in this Reporting Month.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[520px] border-collapse text-xs"><thead className="text-left text-[10px] uppercase tracking-wider text-slate-500"><tr><th scope="col" className="border-b border-slate-800 px-3 py-3">Rank</th><th scope="col" className="border-b border-slate-800 px-3 py-3">Site</th><th scope="col" className="border-b border-slate-800 px-3 py-3">Zone</th><th scope="col" className="border-b border-slate-800 px-3 py-3 text-right">Available Racks</th><th scope="col" className="border-b border-slate-800 px-3 py-3 text-right">Status</th></tr></thead><tbody>{ranked.map(row => { const status = rackAvailabilityStatus(row.available, rows.find(candidate => candidate.siteId === row.siteId && candidate.zone === row.zone)?.total ?? null); return <tr key={`${row.siteId}-${row.zone}`} className="border-b border-slate-800/70 last:border-0"><td className="px-3 py-3 font-mono font-semibold text-slate-300">{row.rank}</td><td className="px-3 py-3 font-medium text-slate-200">{row.siteName}</td><td className="px-3 py-3 text-slate-400">{row.zone}</td><td className="px-3 py-3 text-right font-mono text-emerald-300">{formatFixedNumber(row.available, 0)}</td><td className="px-3 py-3 text-right"><StatusBadge status={status} /></td></tr>; })}</tbody></table></div>}
  </section>;
}

function RackZoneTable({ rows }: { rows: RackRow[] }) {
  const hasOther = rows.some(row => row.other > 0);
  const totals = rows.reduce((result, row) => ({ total: result.total + row.total, inUse: result.inUse + row.inUse, available: result.available + row.available, reserved: result.reserved + row.reserved, pendingDecommission: result.pendingDecommission + row.pendingDecommission, other: result.other + row.other }), { total: 0, inUse: 0, available: 0, reserved: 0, pendingDecommission: 0, other: 0 });
  const reconciled = rows.every(row => row.total === row.inUse + row.available + row.reserved + row.pendingDecommission + row.other) && totals.total === totals.inUse + totals.available + totals.reserved + totals.pendingDecommission + totals.other;
  return <section className="rounded-2xl border border-slate-800 bg-[#0f1a2e] p-5" aria-label="Rack Availability by Zone">
    <div className="mb-4 flex items-center gap-2"><Server className="h-4 w-4 text-indigo-300" /><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Rack Availability by Zone</h3></div>
    {rows.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No Rack Capacity snapshots are available for this Reporting Month.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[920px] border-collapse text-xs"><thead className="text-left text-[10px] uppercase tracking-wider text-slate-500"><tr>{["Site", "Zone", "Total", "In Use", "Available", "Reserved", "Pending Decommission", ...(hasOther ? ["Other"] : []), "Status"].map(label => <th scope="col" key={label} className="border-b border-slate-800 px-3 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{rows.map(row => { const status = rackAvailabilityStatus(row.available, row.total); return <tr key={`${row.siteId}-${row.zone}`} className="border-b border-slate-800/70"><th scope="row" className="px-3 py-3 text-left font-medium text-slate-200">{row.siteName}</th><td className="px-3 py-3 text-slate-400">{row.zone}</td><td className="px-3 py-3 font-mono text-slate-300">{row.total}</td><td className="px-3 py-3 font-mono text-slate-300">{row.inUse}</td><td className="px-3 py-3 font-mono text-emerald-300">{row.available}</td><td className="px-3 py-3 font-mono text-blue-300">{row.reserved}</td><td className="px-3 py-3 font-mono text-amber-300">{row.pendingDecommission}</td>{hasOther && <td className="px-3 py-3 font-mono text-slate-400">{row.other}</td>}<td className="px-3 py-3"><StatusBadge status={status} /></td></tr>; })}<tr className="bg-slate-950/70 font-semibold"><th scope="row" colSpan={2} className="px-3 py-3 text-left text-slate-100">TOTAL</th><td className="px-3 py-3 font-mono text-slate-100">{totals.total}</td><td className="px-3 py-3 font-mono text-slate-100">{totals.inUse}</td><td className="px-3 py-3 font-mono text-emerald-300">{totals.available}</td><td className="px-3 py-3 font-mono text-blue-300">{totals.reserved}</td><td className="px-3 py-3 font-mono text-amber-300">{totals.pendingDecommission}</td>{hasOther && <td className="px-3 py-3 font-mono text-slate-400">{totals.other}</td>}<td className="px-3 py-3" /></tr></tbody></table></div>}
    {!reconciled && <p role="alert" className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">Rack status totals do not reconcile. Review the source snapshot before using this comparison.</p>}
    {hasOther && <p className="mt-4 text-xs text-amber-200">Additional Rack statuses are shown as Other so the requested columns do not hide source records.</p>}
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
  return <section className="rounded-2xl border border-slate-800 bg-[#0f1a2e] p-5" aria-label="Rack Unit Capacity Comparison" data-testid="site-rack-unit-capacity-comparison">
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

export default function WebSiteRackCapacityComparison({ month }: { month: string }) {
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
          api<RackSnapshotApiResponse>(`/racks?siteId=${site.id}&month=${encodeURIComponent(month)}`),
          api<{ snapshot: RackUnitApiSnapshot | null }>(`/rack-unit-capacity?siteId=${site.id}&month=${encodeURIComponent(month)}`)
        ]);
        return {
          site,
          rack: rackResult.status === "fulfilled" ? rackResult.value.snapshot : null,
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
  const rackRows = useMemo(() => rackMetrics.flatMap(({ state, siteOrder, metrics }) => metrics ? metrics.zoneMetrics.map(zone => ({ siteId: state.site.id, siteName: state.site.name, siteOrder, zone: zone.zone, total: zone.total, inUse: zone.inUse.count, available: zone.available.count, reserved: zone.reserved.count, pendingDecommission: zone.pendingDismantle.count, other: zone.other.count } satisfies RackRow)) : []), [rackMetrics]);
  const rackSiteTotals = useMemo(() => rackMetrics.flatMap(({ state, metrics }) => metrics ? [{ siteId: state.site.id, siteName: state.site.name, available: metrics.available.count } satisfies RackSiteTotal] : []), [rackMetrics]);
  const unavailableRackSites = (states ?? []).filter(state => !state.rack);
  const reconciliationMetrics = rackMetrics.flatMap(({ metrics }) => metrics ? [metrics] : []);
  const allRackSnapshotsReconcile = reconciliationMetrics.every(rackCountsReconcile);

  const currentMonthLoaded = loadedMonth === month;
  if (loading && !currentMonthLoaded) return <section role="status" className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">Loading Site Rack Capacity Comparison…</section>;
  if (error && !currentMonthLoaded) return <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100">{error}</section>;
  const sites = currentMonthLoaded ? states ?? [] : [];
  return <section className="space-y-5" data-testid="web-site-rack-capacity-comparison">
    <header className="rounded-2xl border border-slate-800 bg-[#101b30] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-300"><Server className="h-5 w-5" /></div><div><h2 className="font-display text-2xl font-bold tracking-tight text-slate-100">Site Rack Capacity &amp; Availability Comparison</h2><p className="mt-1 text-sm text-slate-400">Available rack positions by site and zone for deployment planning.</p><p className="mt-2 text-xs uppercase tracking-wide text-slate-500">Reporting period: <span className="font-mono text-slate-300">{monthLabelLong(month, "en")}</span></p></div></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-teal-500"><RefreshCw className="h-4 w-4" />Refresh</button></div></header>
    {error && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Some comparison data could not be loaded; unavailable Sites remain excluded from totals and ranking.</p>}
    <div className="grid gap-4 lg:grid-cols-2">{sites.map(state => <SiteSummaryCard key={state.site.id} state={state} month={month} />)}</div>
    {sites.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No active Sites are available for comparison.</p>}
    <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]"><RackAvailabilityChart sites={rackSiteTotals} /><BestLocations rows={rackRows} /></div>
    <RackZoneTable rows={rackRows} />
    {!allRackSnapshotsReconcile && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">Rack status totals require review before this comparison is used for planning.</p>}
    {unavailableRackSites.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-100"><p className="font-semibold">Rack Capacity unavailable</p>{unavailableRackSites.map(state => <p key={state.site.id} className="mt-1">{unavailableText(state, month, "Rack")} Excluded from totals, chart and ranking.</p>)}</div>}
    <RackUnitComparison states={sites} month={month} />
  </section>;
}
