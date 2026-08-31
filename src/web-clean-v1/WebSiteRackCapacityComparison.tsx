import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { BarChart3, Building2, RefreshCw, Search, Server, ShieldCheck, X } from "lucide-react";
import BusyOverlay from "./BusyOverlay";
import { calculateRackCapacityMetrics, rackUtilizationLevel } from "../domain/rackCapacity";
import { isValidRackUnitCapacity, rackAvailabilityStatus, rackCountsReconcile, type RackAvailabilityStatus } from "../domain/rackComparison";
import { usagePercent } from "../domain/rackUnitCapacity";
import { formatFixedNumber, formatFixedPercentage } from "../utils/numberFormat";
import { monthLabelLong } from "../utils/monthUtils";
import { formatRackCabinetSize } from "../utils/rackCapacity";
import { rackStatusHex } from "../utils/rackStatusConfig";
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
  High: "border-rose-400/50 bg-rose-400/10 text-rose-300",
  Unavailable: "border-slate-600 bg-slate-800/70 text-slate-400"
};

function sortSites(left: SiteRef, right: SiteRef): number {
  const preferredOrder = ["Rangsit", "Srinakarin"];
  const leftOrder = preferredOrder.indexOf(left.name);
  const rightOrder = preferredOrder.indexOf(right.name);
  if (leftOrder !== -1 || rightOrder !== -1) return (leftOrder === -1 ? preferredOrder.length : leftOrder) - (rightOrder === -1 ? preferredOrder.length : rightOrder) || left.name.localeCompare(right.name) || left.id - right.id;
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
  return <span className={"inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] " + statusClass[status]}>{status}</span>;
}

function Metric({ label, value, className = "text-slate-200", bordered = false }: { label: string; value: string; className?: string; bordered?: boolean }) {
  return <div className={"min-w-0 " + (bordered ? "border-l border-slate-800 pl-3" : "")}><p className="truncate text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p><p className={"mt-1 font-mono text-sm font-semibold " + className}>{value}</p></div>;
}

function unavailableText(site: SiteComparisonState, month: string, dataset: "Rack" | "Rack Unit"): string {
  if (dataset === "Rack") return (site.rackError ? "Rack data could not be loaded" : "No monthly Rack Capacity snapshot") + " for " + site.site.name + " — " + monthLabelLong(month, "en") + ".";
  return (site.unitError ? "Rack Unit data could not be loaded" : "No monthly Rack Unit Capacity snapshot") + " for " + site.site.name + " — " + monthLabelLong(month, "en") + ".";
}

function rackUnitUnavailableText(site: SiteComparisonState, month: string): string {
  if (site.unitError) return "Rack Unit data could not be loaded for " + site.site.name + " — " + monthLabelLong(month, "en") + ".";
  if (!site.unit) return "No monthly Rack Unit Capacity snapshot for " + site.site.name + " — " + monthLabelLong(month, "en") + ".";
  return "Rack Unit Capacity snapshot for " + site.site.name + " — " + monthLabelLong(month, "en") + " contains invalid non-negative values. It is excluded from the comparison.";
}

const statusBorder: Record<RackAvailabilityStatus, string> = {
  Ready: "#60a5fa",
  Limited: "#fb923c",
  Full: "#f87171"
};

const SiteSummaryCard: FC<{ state: SiteComparisonState; month: string }> = ({ state, month }) => {
  const metrics = state.rack ? calculateRackCapacityMetrics(state.rack.records) : null;
  const availability = metrics && metrics.total > 0 ? (metrics.available.count / metrics.total) * 100 : null;
  const status = metrics ? rackAvailabilityStatus(metrics.available.count, metrics.total) : null;
  return <article className="rounded-2xl border bg-slate-900 p-4 shadow-sm" style={{ borderColor: status ? statusBorder[status] + "80" : "#334155" }} data-testid={"rack-comparison-site-" + state.site.id}>
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

type ZoneSegment = { key: string; label: string; count: number; ratio: number | null; color: string };

export function zoneAvailableTotalLabel(zone: { available: { count: number }; total: number }): string {
  return formatFixedNumber(zone.available.count, 0) + " / " + formatFixedNumber(zone.total, 0);
}
function zoneSegments(zone: ReturnType<typeof calculateRackCapacityMetrics>["zoneMetrics"][number]): ZoneSegment[] {
  return [
    { key: "inUse", label: "In Use", count: zone.inUse.count, ratio: zone.inUse.ratio, color: rackStatusHex("In Use") },
    { key: "available", label: "Available", count: zone.available.count, ratio: zone.available.ratio, color: rackStatusHex("Available") },
    { key: "reserved", label: "Reserved", count: zone.reserved.count, ratio: zone.reserved.ratio, color: rackStatusHex("Reserved") },
    { key: "pending", label: "Pending Decommission", count: zone.pendingDismantle.count, ratio: zone.pendingDismantle.ratio, color: rackStatusHex("Pending Dismantle") }
  ];
}

function ZoneStatusStack({ zone, scaleMax }: { zone: ReturnType<typeof calculateRackCapacityMetrics>["zoneMetrics"][number]; scaleMax: number }) {
  const segments = zoneSegments(zone);
  const tooltip = [zone.zone, "Total: " + formatFixedNumber(zone.total, 0)].concat(segments.map(segment => segment.label + ": " + formatFixedNumber(segment.count, 0))).join(" | ");
  return <div className="flex h-7 min-w-0 overflow-hidden rounded-md border border-slate-700 bg-slate-950" role="img" aria-label={tooltip} title={tooltip}>
    {segments.map(segment => {
      const width = scaleMax > 0 ? (segment.count / scaleMax) * 100 : 0;
      const showLabel = segment.count > 0 && width >= 12;
      return <div key={segment.key} className="flex min-w-0 items-center justify-center overflow-hidden px-1 text-[10px] font-semibold text-white" style={{ width: width + "%", backgroundColor: segment.color }} title={segment.label + ": " + formatFixedNumber(segment.count, 0)}>{showLabel ? formatFixedNumber(segment.count, 0) : null}</div>;
    })}
  </div>;
}

function ZoneLegend() {
  return <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">{zoneSegments({ zone: "", total: 1, countsByStatus: {}, inUse: { count: 1, ratio: 1 }, available: { count: 1, ratio: 1 }, reserved: { count: 1, ratio: 1 }, pendingDismantle: { count: 1, ratio: 1 }, other: { count: 0, ratio: 0 } }).map(segment => <span key={segment.key} className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: segment.color }} />{segment.label}</span>)}</div>;
}

function RackCapacityByZone({ states, month }: { states: SiteComparisonState[]; month: string }) {
  const scaleMax = states.reduce((maximum, state) => {
    const metrics = state.rack ? calculateRackCapacityMetrics(state.rack.records) : null;
    return Math.max(maximum, ...(metrics?.zoneMetrics.map(zone => zone.total) ?? []));
  }, 1);
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5" aria-label="Rack Capacity by Zone" data-testid="rack-comparison-zone-availability">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-indigo-300" /><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Rack Capacity by Zone</h3></div><div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2"><ZoneLegend /><span className="text-[10px] uppercase tracking-[0.08em] text-slate-500">Shared scale: 0 to {formatFixedNumber(scaleMax, 0)} racks</span></div></div>
    <div className="grid gap-5 lg:grid-cols-2">{states.map(state => {
      const metrics = state.rack ? calculateRackCapacityMetrics(state.rack.records) : null;
      return <article key={state.site.id} className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/30 p-3 sm:p-4"><div className="mb-3"><h4 className="flex items-center gap-2 font-display text-sm font-bold text-sky-300"><Building2 className="h-4 w-4" />{state.site.name}</h4>{metrics && <p className="mt-1 text-xs text-slate-500">Available <span className="font-mono text-emerald-300">{formatFixedNumber(metrics.available.count, 0)}</span><span className="text-slate-500"> / </span><span className="font-mono text-slate-300">{formatFixedNumber(metrics.total, 0)}</span> racks</p>}</div>{!metrics ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-amber-200">{unavailableText(state, month, "Rack")}</p> : metrics.zoneMetrics.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-500">No rack zones exist for this month.</p> : <><div className="mb-2 grid grid-cols-[3.5rem_minmax(0,1fr)_6.5rem] items-center gap-2.5 px-1 text-[10px] uppercase tracking-[0.08em] text-slate-500"><span /><span /><span className="whitespace-nowrap text-right">Available / Total</span></div><div className="space-y-2.5">{metrics.zoneMetrics.map(zone => <div key={zone.zone} className="grid grid-cols-[3.5rem_minmax(0,1fr)_6.5rem] items-center gap-2.5"><span className="truncate text-xs font-semibold text-slate-300">{zone.zone}</span><ZoneStatusStack zone={zone} scaleMax={scaleMax} /><span className="whitespace-nowrap text-right font-mono text-xs" aria-label={"Available / Total: " + zoneAvailableTotalLabel(zone)}><span className="text-emerald-300">{formatFixedNumber(zone.available.count, 0)}</span><span className="text-slate-500"> / </span><span className="text-slate-300">{formatFixedNumber(zone.total, 0)}</span></span></div>)}</div></>}</article>;
    })}</div>
    {states.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No active Sites are available for comparison.</p>}
  </section>;
}
function RackCapacityDetails({ states, month }: { states: SiteComparisonState[]; month: string }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5" aria-label="Rack Capacity Details" data-testid="rack-comparison-details">
    <div className="mb-4 flex items-center gap-2"><Server className="h-4 w-4 text-indigo-300" /><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Rack Capacity Details</h3><span className="text-xs text-slate-500">Counts by zone</span></div>
    <div className="grid gap-5 lg:grid-cols-2">{states.map(state => {
      const metrics = state.rack ? calculateRackCapacityMetrics(state.rack.records) : null;
      return <article key={state.site.id} className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/30 p-3 sm:p-4"><h4 className="mb-3 font-display text-sm font-bold text-slate-200">{state.site.name} Rack Capacity Details</h4>{!metrics ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-amber-200">{unavailableText(state, month, "Rack")}</p> : metrics.zoneMetrics.length === 0 ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-500">No rack zones exist for this month.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[620px] border-collapse text-xs"><thead className="text-left text-[10px] uppercase tracking-wider text-slate-500"><tr>{["Zone", "Total", "In Use", "Available", "Reserved", "Pending Decommission"].map(label => <th key={label} scope="col" className="border-b border-slate-800 px-2 py-2 font-semibold">{label}</th>)}</tr></thead><tbody>{metrics.zoneMetrics.map(zone => <tr key={zone.zone} className="border-b border-slate-800/70 last:border-0"><th scope="row" className="px-2 py-2 text-left font-semibold text-slate-200">{zone.zone}</th><td className="px-2 py-2 font-mono text-slate-300">{formatFixedNumber(zone.total, 0)}</td><td className="px-2 py-2 font-mono text-amber-300">{formatFixedNumber(zone.inUse.count, 0)}</td><td className="px-2 py-2 font-mono text-emerald-300">{formatFixedNumber(zone.available.count, 0)}</td><td className="px-2 py-2 font-mono text-sky-300">{formatFixedNumber(zone.reserved.count, 0)}</td><td className="px-2 py-2 font-mono text-amber-300">{formatFixedNumber(zone.pendingDismantle.count, 0)}</td></tr>)}</tbody></table></div>}</article>;
    })}</div>
    {states.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No active Sites are available for comparison.</p>}
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
    <div className="mb-4 flex items-center gap-2"><Building2 className="h-4 w-4 text-sky-300" /><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Rack Positions</h3><span className="text-xs text-slate-500">{filtered.length} deployment-relevant rows</span></div>
    <div className="space-y-3">{states.map(state => {
      const siteRows = rackPositions(state);
      const rows = filtered.filter(row => row.siteId === state.site.id);
      return <details key={state.site.id} className="group rounded-xl border border-slate-800 bg-slate-950/30" data-testid={"rack-positions-site-" + state.site.id}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 marker:hidden [&::-webkit-details-marker]:hidden"><span className="flex min-w-0 items-center gap-2 font-display text-sm font-bold text-slate-200"><Building2 className="h-4 w-4 shrink-0 text-sky-300" /><span className="truncate">{state.site.name} Rack Positions</span></span><span className="flex shrink-0 flex-wrap justify-end gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]"><span className="rounded-full border border-emerald-400/40 px-2 py-1 text-emerald-300">Available {siteRows.filter(row => row.status === "Available").length}</span><span className="rounded-full border border-sky-400/40 px-2 py-1 text-sky-300">Reserved {siteRows.filter(row => row.status === "Reserved").length}</span><span className="rounded-full border border-amber-400/40 px-2 py-1 text-amber-300">Pending Decommission {siteRows.filter(row => row.status === "Pending Decommission").length}</span></span></summary>
        <div className="border-t border-slate-800 p-3">{!state.rack ? <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm leading-relaxed text-amber-200">No confirmed Rack Capacity snapshot for {state.site.name} — {monthLabelLong(month, "en")}.</p> : <div className="grid gap-3 lg:grid-cols-3">{RACK_POSITION_STATUSES.map(status => { const statusRows = rows.filter(row => row.status === status); return <section key={status} className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/40 p-3" data-testid={"rack-positions-" + state.site.id + "-" + status.toLowerCase().replaceAll(" ", "-")}><div className="mb-3 flex items-center justify-between gap-2"><h5 className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">{status}</h5><span className="font-mono text-xs text-slate-400">{statusRows.length}</span></div>{statusRows.length === 0 ? <p className="py-8 text-center text-xs text-slate-500">No {status.toLowerCase()} rack positions.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[300px] border-collapse text-xs"><thead className="text-left text-[10px] uppercase tracking-wider text-slate-500"><tr><th scope="col" className="border-b border-slate-800 px-2 py-2">Rack ID</th><th scope="col" className="border-b border-slate-800 px-2 py-2">Cabinet Size (cm)</th><th scope="col" className="border-b border-slate-800 px-2 py-2">Detail</th></tr></thead><tbody>{statusRows.map(row => <tr key={row.siteId + "-" + row.status + "-" + (row.rackId ?? "blank")} className="border-b border-slate-800/70 last:border-0"><th scope="row" className="whitespace-nowrap px-2 py-2 font-mono font-medium text-sky-300">{row.rackId ?? "—"}</th><td className="whitespace-nowrap px-2 py-2 text-slate-300">{formatRackCabinetSize(row.cabinetSize)}</td><td className="px-2 py-2 text-slate-400">{row.detail ?? "—"}</td></tr>)}</tbody></table></div>}</section>; })}</div>}</div>
      </details>;
    })}</div>
    {states.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">No active Sites are available for comparison.</p>}
  </section>;
}

function RackUnitComparison({ states, month }: { states: SiteComparisonState[]; month: string }) {
  const rows = states.flatMap(state => {
    const snapshot = state.unit;
    if (!snapshot || !isValidRackUnitCapacity(snapshot.totalU, snapshot.usedU)) return [];
    const usage = usagePercent(snapshot);
    return [{ state, snapshot, available: snapshot.totalU - snapshot.usedU, usage, status: usage === null ? "Unavailable" as const : rackUtilizationLevel(usage) }];
  });
  const unavailable = states.filter(state => !state.unit || !isValidRackUnitCapacity(state.unit.totalU, state.unit.usedU));
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5" aria-label="Rack Unit Capacity Comparison" data-testid="site-rack-unit-capacity-comparison">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-sky-300" /><div><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">Rack Unit Capacity Comparison</h3><p className="mt-1 text-xs text-slate-400">Used and available rack units by site — {monthLabelLong(month, "en")}</p></div></div><span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Compact view</span></div>
    {rows.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No valid Rack Unit Capacity snapshots are available for this Reporting Month.</p> : <div className="grid gap-3 lg:grid-cols-2">{rows.map(row => {
      const total = row.snapshot.totalU;
      const usedWidth = total > 0 ? Math.max(0, Math.min(100, row.snapshot.usedU / total * 100)) : 0;
      const availableWidth = total > 0 ? Math.max(0, Math.min(100, row.available / total * 100)) : 0;
      return <article key={row.state.site.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="flex items-start justify-between gap-3"><div><h4 className="font-display text-base font-bold text-slate-100">{row.state.site.name}</h4><p className="mt-0.5 text-xs text-slate-500">{row.state.site.code}</p></div><div className="text-right"><p className="font-mono text-xl font-semibold text-sky-300">{formatFixedPercentage(row.usage, 1)}</p><span className={"mt-1 inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] " + statusClass[row.status]}>{row.status}</span></div></div><div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={"Used " + formatFixedNumber(row.snapshot.usedU, 0) + " U; Available " + formatFixedNumber(row.available, 0) + " U"}><div className="h-full bg-orange-400" style={{ width: usedWidth + "%" }} /><div className="h-full bg-emerald-400" style={{ width: availableWidth + "%" }} /></div><div className="mt-3 grid grid-cols-3 gap-2 text-xs"><Metric label="Total U" value={formatFixedNumber(total, 0)} /><Metric label="Used U" value={formatFixedNumber(row.snapshot.usedU, 0)} className="text-orange-300" bordered /><Metric label="Available U" value={formatFixedNumber(row.available, 0)} className="text-emerald-300" bordered /></div></article>;
    })}</div>}
    {unavailable.length > 0 && <div className="mt-4 space-y-1 text-xs text-amber-200">{unavailable.map(state => <p key={state.site.id}>{rackUnitUnavailableText(state, month)}</p>)}</div>}
  </section>;
}

export default function WebSiteRackCapacityComparison({ month, activePeriodLabel: _activePeriodLabel }: { month: string; activePeriodLabel?: string }) {
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
  if (loading && !currentMonthLoaded) return <BusyOverlay title="Loading Site Rack Capacity Comparison…" progressLabel="Loading" />;
  if (error && !currentMonthLoaded) return <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100">{error}</section>;
  const sites = currentMonthLoaded ? states ?? [] : [];
  return <section className="space-y-5" data-testid="web-site-rack-capacity-comparison">
    {loading && <BusyOverlay title="Loading Site Rack Capacity Comparison…" progressLabel="Loading" />}
    <header className="rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-300"><Server className="h-5 w-5" /></div><div><h2 className="font-display text-2xl font-bold tracking-tight text-slate-100">Site Rack Capacity &amp; Availability Comparison</h2><p className="mt-1 text-sm text-slate-400">Compare site rack capacity by zone and status for deployment planning.</p><p className="mt-2 text-xs uppercase tracking-wide text-slate-500">Reporting Month: <span className="font-mono text-slate-300">{monthLabelLong(month, "en")}</span></p></div></div><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-teal-500"><RefreshCw className="h-4 w-4" />Refresh</button></div></header>
    <div className="grid gap-4 lg:grid-cols-2">{sites.map(state => <SiteSummaryCard key={state.site.id} state={state} month={month} />)}</div>
    <RackCapacityByZone states={sites} month={month} />
    <RackCapacityDetails states={sites} month={month} />
    <RackPositions states={sites} month={month} />
    {!allRackSnapshotsReconcile && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">Rack status totals require review before this comparison is used for planning.</p>}
    {unavailableRackSites.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-100"><p className="font-semibold">Rack Capacity unavailable</p>{unavailableRackSites.map(state => <p key={state.site.id} className="mt-1">{unavailableText(state, month, "Rack")} Excluded from totals and planning views.</p>)}</div>}
    <RackUnitComparison states={sites} month={month} />
  </section>;
}
