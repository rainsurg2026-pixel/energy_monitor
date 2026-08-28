import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Boxes, CheckCircle2, Clock3, Gauge, ImagePlus, Info, Server, ShieldCheck, TrendingUp } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IDataProvider } from "../data/IDataProvider";
import type { StoredImageMeta } from "../storage/ImageStorageProvider";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import type { RackCapacitySummary } from "../reports/reportTypes";
import { calculateRackCapacityMetrics, rackUtilizationLevel } from "../utils/rackCapacity";
import { formatFixedNumber, formatFixedPercentage, roundToDecimals } from "../utils/numberFormat";
import { formatTimestamp } from "../utils";
import { findPreviousRackUnitCapacityRow } from "../utils/rackUnitCapacity";
import { monthLabelLong, monthLabelShort, shiftMonth } from "../utils/monthUtils";
import { RackCapacityProvider, useRackCapacity } from "../components/rack/RackCapacityContext";
import { WebRackCapacityEditor, type RackApiSnapshot } from "./WebRackCapacityEditors";

const STATUS_COLORS = {
  inUse: "#f5c542",
  available: "#35d07f",
  reserved: "#4f8cff",
  pending: "#f59e0b",
  other: "#64748b"
} as const;
const UTILIZATION_TOOLTIP = "Normal: < 80% · Attention: 80–84.9% · High: ≥ 85%";

function summaryFromSnapshot(snapshot: RackApiSnapshot | null): RackCapacitySummary | null {
  if (!snapshot) return null;
  const byStatus = new Map<string, number>();
  const byZone = new Map<string, number>();
  const records = snapshot.records.map(record => {
    const zone = record.rackZone ?? "(blank)";
    const status = record.status ?? "(blank)";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
    return { ...record, rowNumber: record.rowNumber ?? 0 };
  });
  return { totalRacks: records.length, records, byStatus: Array.from(byStatus, ([status, count]) => ({ status, count })), byZone: Array.from(byZone, ([zone, count]) => ({ zone, count })) };
}

function ratioPercent(ratio: number | null): number | null { return ratio === null || !Number.isFinite(ratio) ? null : ratio * 100; }
function safePercent(value: number | null): string { return formatFixedPercentage(value, 1); }
function safeDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatTimestamp(date) : value;
}
function clampPercent(value: number | null): number { return value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value)); }

function MiniSparkline({ values, color }: { values: Array<number | null>; color: string }) {
  const points = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points.map((value, index) => `${(index / (points.length - 1)) * 100},${28 - ((value - min) / span) * 24}`).join(" ");
  return <svg aria-hidden="true" className="h-8 w-20" viewBox="0 0 100 30" preserveAspectRatio="none"><polyline fill="none" points={path} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" /></svg>;
}

function MetricCard({ icon: Icon, label, value, sub, accent, sparkline }: { icon: LucideIcon; label: string; value: string; sub?: string; accent: string; sparkline?: Array<number | null> }) {
  return <article className="min-h-[132px] rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm" style={{ borderTopColor: accent }}><div className="flex items-start justify-between gap-2"><div className="rounded-lg p-2" style={{ backgroundColor: `${accent}20`, color: accent }}><Icon className="h-4 w-4" /></div>{sparkline && <MiniSparkline values={sparkline} color={accent} />}</div><p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 font-mono text-2xl font-semibold text-slate-100">{value}</p>{sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}</article>;
}

function Section({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-sm ${className}`}><div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-slate-200">{title}</h3></div>{children}</section>;
}

function CapacityMix({ metrics }: { metrics: ReturnType<typeof calculateRackCapacityMetrics> }) {
  const items = [
    { key: "inUse", label: "In Use", count: metrics.inUse.count, ratio: metrics.inUse.ratio, color: STATUS_COLORS.inUse },
    { key: "available", label: "Available", count: metrics.available.count, ratio: metrics.available.ratio, color: STATUS_COLORS.available },
    { key: "reserved", label: "Reserved", count: metrics.reserved.count, ratio: metrics.reserved.ratio, color: STATUS_COLORS.reserved },
    { key: "pending", label: "Pending Dismantle", count: metrics.pendingDismantle.count, ratio: metrics.pendingDismantle.ratio, color: STATUS_COLORS.pending },
    { key: "other", label: "Other", count: metrics.other.count, ratio: metrics.other.ratio, color: STATUS_COLORS.other }
  ].filter(item => item.count > 0 || item.key !== "other");
  return <div className="space-y-4"><div className="flex h-8 w-full overflow-hidden rounded-lg bg-slate-800" aria-label="Overall Rack Capacity Mix">{items.map(item => <div key={item.key} title={`${item.label}: ${item.count} (${safePercent(ratioPercent(item.ratio))})`} style={{ width: `${metrics.total > 0 ? (item.count / metrics.total) * 100 : 0}%`, backgroundColor: item.color }} />)}</div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map(item => <div key={item.key} className="flex items-center justify-between gap-3 text-xs"><span className="inline-flex min-w-0 items-center gap-2 text-slate-300"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span><span className="font-mono text-slate-100">{item.count} <span className="text-slate-500">({safePercent(ratioPercent(item.ratio))})</span></span></div>)}</div></div>;
}

function InsightRow({ icon: Icon, children, accent = "#94a3b8" }: { icon: LucideIcon; children: ReactNode; accent?: string }) {
  return <div className="flex items-start gap-3 border-b border-slate-800/80 py-3 last:border-0"><Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} /><p className="text-xs leading-relaxed text-slate-300">{children}</p></div>;
}

function zoneGrammar(zones: string[]): string {
  const labels = zones.map(zone => zone.replace(/^zone\s+/iu, "").trim() || zone);
  if (zones.length === 0) return "No zones are at or above 85% utilization.";
  if (labels.length === 1) return `Zone ${labels[0]} is over 85% utilized.`;
  if (labels.length === 2) return `Zones ${labels[0]} and ${labels[1]} are over 85% utilized.`;
  return `Zones ${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)} are over 85% utilized.`;
}

function ZoneBreakdown({ metrics }: { metrics: ReturnType<typeof calculateRackCapacityMetrics> }) {
  return <Section title="Rack Zone Breakdown"><div className="mb-3 flex items-center gap-2 text-[11px] text-slate-500"><Info className="h-3.5 w-3.5" />Utilization status: <span title={UTILIZATION_TOOLTIP}>{UTILIZATION_TOOLTIP}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] border-collapse text-xs"><thead className="text-left text-[10px] uppercase tracking-wider text-slate-500"><tr>{["Zone", "Total", "In Use", "Available", "Reserved", "Pending Dismantle", "Utilization"].map(label => <th key={label} className="border-b border-slate-800 px-3 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{metrics.zoneMetrics.map(zone => { const usage = ratioPercent(zone.inUse.ratio); const level = rackUtilizationLevel(usage); const levelClass = level === "High" ? "bg-rose-500/15 text-rose-300" : level === "Attention" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"; return <tr key={zone.zone} className="border-b border-slate-800/70 last:border-0"><td className="px-3 py-3 font-semibold text-slate-200">{zone.zone}</td><td className="px-3 py-3 font-mono text-slate-300">{zone.total}</td><td className="px-3 py-3"><div className="font-mono text-slate-200">{zone.inUse.count}</div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full" style={{ width: `${clampPercent(ratioPercent(zone.inUse.ratio))}%`, backgroundColor: STATUS_COLORS.inUse }} /></div></td><td className="px-3 py-3 font-mono text-emerald-300">{zone.available.count}</td><td className="px-3 py-3 font-mono text-blue-300">{zone.reserved.count}</td><td className="px-3 py-3 font-mono text-amber-300">{zone.pendingDismantle.count}</td><td className="px-3 py-3"><div className="flex items-center gap-2"><span className="font-mono text-slate-100">{safePercent(usage)}</span><span title={UTILIZATION_TOOLTIP} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${levelClass}`}>{level}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full" style={{ width: `${clampPercent(usage)}%`, backgroundColor: level === "High" ? "#fb7185" : level === "Attention" ? "#f59e0b" : "#34d399" }} /></div></td></tr>; })}</tbody></table></div>{metrics.zoneMetrics.length === 0 && <p className="py-5 text-center text-sm text-slate-500">No rack zones exist for this month.</p>}</Section>;
}

function RackCapacityDashboardInner({ siteId, month, snapshot, history, onSaved, onDirtyChange }: { siteId: number; month: string; snapshot: RackApiSnapshot | null; history: RackCapacityHistoryRow[]; onSaved?: (snapshot: RackApiSnapshot, history: RackCapacityHistoryRow[]) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { metrics } = useRackCapacity();
  const qualifyingZones = metrics.zoneMetrics.filter(zone => (ratioPercent(zone.inUse.ratio) ?? 0) >= 85).map(zone => zone.zone);
  const highestPending = [...metrics.zoneMetrics].sort((a, b) => b.pendingDismantle.count - a.pendingDismantle.count)[0];
  const totalHistory = [...history].filter(row => row.rackZone === "(Total)").sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth));
  const updatedAt = history.find(row => row.snapshotMonth === month && row.rackZone === "(Total)")?.generatedAt;
  const pct = (ratio: number | null) => safePercent(ratioPercent(ratio));
  return <div className="space-y-5"><div className="space-y-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 shadow-sm sm:p-6"><header className="rounded-xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-start gap-3"><div className="rounded-xl bg-rose-500/10 p-2.5 text-rose-300"><Server className="h-5 w-5" /></div><div><h2 className="font-display text-2xl font-bold tracking-tight text-slate-100">Rack Capacity &amp; Utilization — {monthLabelLong(month, "en")}</h2><p className="mt-1 text-sm text-slate-400">Rack capacity, status and utilization summary</p></div></div></header><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><MetricCard icon={Server} label="Total Racks" value={formatFixedNumber(metrics.total, 0)} sub="Racks" accent="#64748b" sparkline={totalHistory.map(row => row.inUse + row.available + row.reserved + row.pendingDismantle)} /><MetricCard icon={CheckCircle2} label="In Use" value={formatFixedNumber(metrics.inUse.count, 0)} sub={`${pct(metrics.inUse.ratio)} of total`} accent={STATUS_COLORS.inUse} sparkline={totalHistory.map(row => row.inUse)} /><MetricCard icon={ShieldCheck} label="Available" value={formatFixedNumber(metrics.available.count, 0)} sub={`${pct(metrics.available.ratio)} of total`} accent={STATUS_COLORS.available} sparkline={totalHistory.map(row => row.available)} /><MetricCard icon={Clock3} label="Reserved" value={formatFixedNumber(metrics.reserved.count, 0)} sub={`${pct(metrics.reserved.ratio)} of total`} accent={STATUS_COLORS.reserved} sparkline={totalHistory.map(row => row.reserved)} /><MetricCard icon={AlertTriangle} label="Pending Dismantle" value={formatFixedNumber(metrics.pendingDismantle.count, 0)} sub={`${pct(metrics.pendingDismantle.ratio)} of total`} accent={STATUS_COLORS.pending} sparkline={totalHistory.map(row => row.pendingDismantle)} /></div><div className="grid gap-5 xl:grid-cols-[1.12fr_0.88fr]"><Section title="Overall Capacity Mix"><CapacityMix metrics={metrics} /></Section><Section title="Key Insights"><InsightRow icon={Gauge} accent="#60a5fa">Utilization is {safePercent(ratioPercent(metrics.inUse.ratio))} ({metrics.inUse.count} / {metrics.total} racks).</InsightRow><InsightRow icon={TrendingUp} accent="#f472b6">{zoneGrammar(qualifyingZones)}</InsightRow><InsightRow icon={Clock3} accent="#f59e0b">{highestPending && highestPending.pendingDismantle.count > 0 ? `${highestPending.zone} has the highest pending dismantle count (${highestPending.pendingDismantle.count} racks).` : "No racks are pending dismantle."}</InsightRow><InsightRow icon={AlertTriangle} accent="#f59e0b">{metrics.available.count} racks are available for allocation.</InsightRow></Section></div><ZoneBreakdown metrics={metrics} /><p className="text-center text-[11px] text-slate-500">Last updated: {safeDate(updatedAt)}</p></div><WebRackCapacityEditor siteId={siteId} month={month} snapshot={snapshot} onSaved={onSaved} onDirtyChange={onDirtyChange} /></div>;
}

export function WebRackCapacityDashboard({ siteId, siteName, month, snapshot, rackCapacityHistory, rackUnitCapacity, resetVersion = 0, onSaved, onDirtyChange }: { siteId: number; siteName: string | null; month: string; snapshot: RackApiSnapshot | null; rackCapacityHistory: RackCapacityHistoryRow[]; rackUnitCapacity: RackUnitCapacityRow[]; resetVersion?: number; onSaved?: (snapshot: RackApiSnapshot, history: RackCapacityHistoryRow[]) => void; onDirtyChange?: (dirty: boolean) => void }) {
  if (!snapshot) return <section role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 text-sm text-amber-100">Rack Capacity data is unavailable for {monthLabelLong(month, "en")}. No monthly Rack Capacity snapshot exists for the selected Reporting Month.</section>;
  return <RackCapacityProvider key={`${siteId}:${month}:${resetVersion}`} lang="en" facilityName={siteName} initialReportingMonth={month} rackCapacity={summaryFromSnapshot(snapshot)} rackUnitCapacity={rackUnitCapacity} rackCapacityHistory={rackCapacityHistory}><RackCapacityDashboardInner siteId={siteId} month={month} snapshot={snapshot} history={rackCapacityHistory} onSaved={onSaved} onDirtyChange={onDirtyChange} /></RackCapacityProvider>;
}

function UCapacityMix({ total, used, available, hasData }: { total: number; used: number; available: number; hasData?: boolean }) {
  const usedWidth = total > 0 ? clampPercent((used / total) * 100) : 0;
  const availableWidth = total > 0 ? clampPercent((Math.max(0, available) / total) * 100) : 0;
  const hasCapacityData = hasData ?? total > 0;
  if (!hasCapacityData) return <div className="space-y-4"><div className="flex h-8 items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-500">No monthly Rack Unit Capacity snapshot</div><p className="text-xs text-slate-500">Capacity mix is unavailable for the selected Reporting Month.</p></div>;
  return <div className="space-y-4"><div className="flex h-8 overflow-hidden rounded-lg bg-slate-800"><div className="h-full bg-orange-400" style={{ width: `${usedWidth}%` }} /><div className="h-full bg-emerald-400" style={{ width: `${availableWidth}%` }} /></div><div className="grid gap-3 sm:grid-cols-2"><div className="flex items-center justify-between text-xs"><span className="inline-flex items-center gap-2 text-slate-300"><i className="h-2.5 w-2.5 rounded-full bg-orange-400" />Used U</span><span className="font-mono text-slate-100">{formatFixedNumber(used, 1)}</span></div><div className="flex items-center justify-between text-xs"><span className="inline-flex items-center gap-2 text-slate-300"><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Available U</span><span className="font-mono text-slate-100">{formatFixedNumber(Math.max(0, available), 1)}</span></div></div><div className="border-t border-slate-800 pt-3 text-xs text-slate-500">Total physical rack space: <span className="font-mono text-slate-200">{formatFixedNumber(total, 1)} U</span></div></div>;
}

function HealthGauge({ usage }: { usage: number | null }) {
  const level = usage === null ? null : rackUtilizationLevel(usage);
  const color = level === "High" ? "#fb7185" : level === "Attention" ? "#f59e0b" : level === "Normal" ? "#34d399" : "#64748b";
  return <div className="relative h-36"><svg className="h-full w-full" viewBox="0 0 200 115" role="img" aria-label={`Capacity health ${safePercent(usage)}`}><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#1e293b" strokeLinecap="round" strokeWidth="18" /><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" pathLength="100" stroke={color} strokeDasharray={`${clampPercent(usage)} 100`} strokeLinecap="round" strokeWidth="18" /></svg><div className="pointer-events-none absolute inset-x-0 bottom-0 text-center"><p className="font-mono text-3xl font-semibold" style={{ color }}>{safePercent(usage)}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{level ? `${level} Utilization` : "Unavailable"}</p></div></div>;
}

function RackUnitImage({ provider, facilityName, month }: { provider?: Pick<IDataProvider, "getRackUnitCapacityImage"> | null; facilityName: string | null; month: string }) {
  const [image, setImage] = useState<{ dataUri: string; meta: StoredImageMeta } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!provider?.getRackUnitCapacityImage) { setImage(null); return; }
    setLoading(true);
    provider.getRackUnitCapacityImage(facilityName ?? "", month).then(result => { if (!cancelled) setImage(result ? { dataUri: result.dataUri, meta: result.meta } : null); }).catch(() => { if (!cancelled) setImage(null); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [facilityName, month, provider]);
  return <Section title="Monthly Rack Unit Capacity Image"><div className="min-h-[240px]">{loading ? <div className="flex h-60 items-center justify-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-500">Loading image…</div> : image ? <figure className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950"><img src={image.dataUri} alt={`Monthly Rack Unit Capacity for ${monthLabelLong(month, "en")}`} className="max-h-[520px] w-full object-contain" /><figcaption className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-800 px-4 py-3 text-[11px] text-slate-400"><span>{monthLabelLong(month, "en")}</span><span>Last updated: {safeDate(image.meta.savedAt)}</span><span>Resolution: {image.meta.width}×{image.meta.height}px</span><span>Captured by: {image.meta.savedBy}</span></figcaption></figure> : <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-700 text-center text-slate-500"><ImagePlus className="h-7 w-7" /><p className="text-sm">No authorized Rack Unit Capacity image is available for this month.</p><p className="text-xs text-slate-600">Upload metadata is read from the existing Production storage path.</p></div>}</div></Section>;
}

function RackUnitCapacityDashboardInner({ month, facilityName, imageProvider }: { month: string; facilityName: string | null; imageProvider?: Pick<IDataProvider, "getRackUnitCapacityImage"> | null }) {
  const { rackUnitCapacity, unitCapacityRow } = useRackCapacity();
  const total = unitCapacityRow?.totalU ?? 0;
  const used = unitCapacityRow?.usedU ?? 0;
  const available = unitCapacityRow ? total - used : 0;
  const usage = unitCapacityRow && total > 0 ? (used / total) * 100 : null;
  const availability = unitCapacityRow && total > 0 ? (available / total) * 100 : null;
  const previous = useMemo(() => findPreviousRackUnitCapacityRow(rackUnitCapacity, month), [month, rackUnitCapacity]);
  const previousUsage = previous && previous.totalU > 0 ? (previous.usedU / previous.totalU) * 100 : null;
  const trendPoints = usage !== null && previousUsage !== null ? usage - previousUsage : null;
  const trendLabel = trendPoints === null ? (unitCapacityRow ? "No prior month" : "No current month data") : `${trendPoints >= 0 ? "▲" : "▼"} ${formatFixedNumber(Math.abs(trendPoints), 1)} pp vs previous month`;
  const trendMonths = useMemo(() => Array.from({ length: 6 }, (_, index) => shiftMonth(month, index - 5)), [month]);
  const byMonth = useMemo(() => new Map(rackUnitCapacity.map(row => [row.month, row] as const)), [rackUnitCapacity]);
  const trendData = trendMonths.map(targetMonth => { const row = byMonth.get(targetMonth); return { month: monthLabelShort(targetMonth, "en"), total: row ? roundToDecimals(row.totalU, 1) : null, used: row ? roundToDecimals(row.usedU, 1) : null, available: row ? roundToDecimals(row.availableU, 1) : null }; });
  const detailRows = trendMonths.map(targetMonth => byMonth.get(targetMonth) ?? null).filter((row): row is RackUnitCapacityRow => row !== null);
  const chartMax = Math.max(1, ...trendData.flatMap(row => [row.total ?? 0, row.used ?? 0, row.available ?? 0])) * 1.15;
  return <div className="space-y-5"><header className="rounded-xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-300"><Boxes className="h-5 w-5" /></div><div><h2 className="font-display text-2xl font-bold tracking-tight text-slate-100">Rack Unit Capacity &amp; Utilization <span className="text-blue-400">• {monthLabelLong(month, "en")}</span></h2><p className="mt-1 text-sm text-slate-400">Executive summary of rack unit (U) capacity and utilization.</p></div></div><div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">As of <span className="font-mono text-slate-300">{month}</span></div></div></header><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><MetricCard icon={Boxes} label="Total U" value={formatFixedNumber(unitCapacityRow ? total : null, 1)} accent="#60a5fa" /><MetricCard icon={TrendingUp} label="Used U" value={formatFixedNumber(unitCapacityRow ? used : null, 1)} accent="#fb923c" /><MetricCard icon={CheckCircle2} label="Available U" value={formatFixedNumber(unitCapacityRow ? available : null, 1)} accent="#34d399" /><MetricCard icon={Gauge} label="Usage %" value={safePercent(usage)} accent="#f59e0b" /><MetricCard icon={ShieldCheck} label="Availability %" value={safePercent(availability)} accent="#a78bfa" /></div><div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]"><Section title="Overall U Capacity Mix"><UCapacityMix total={total} used={used} available={available} /></Section><Section title="Capacity Health"><HealthGauge usage={usage} /><div className="mt-2 grid gap-2 text-xs sm:grid-cols-2"><div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3"><p className="text-slate-500">Available capacity</p><p className="mt-1 font-mono text-slate-100">{formatFixedNumber(unitCapacityRow ? available : null, 1)} U</p></div><div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3"><p className="text-slate-500">Trend vs previous month</p><p className={`mt-1 font-mono ${trendPoints !== null && trendPoints > 0 ? "text-rose-300" : "text-emerald-300"}`}>{trendLabel}</p></div></div></Section></div><Section title="Six-month Rack Unit Capacity Trend"><div className="mb-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400"><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-blue-400" />Total U</span><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-orange-400" />Used U</span><span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Available U</span></div><div className="h-64"><ResponsiveContainer width="100%" height="100%"><LineChart data={trendData} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}><CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" /><XAxis dataKey="month" stroke="#64748b" fontSize={11} /><YAxis domain={[0, chartMax]} stroke="#64748b" fontSize={11} tickFormatter={value => formatFixedNumber(Number(value), 0)} /><Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} formatter={value => `${formatFixedNumber(Number(value), 1)} U`} /><Line connectNulls={false} dataKey="total" name="Total U" stroke="#60a5fa" strokeWidth={2.5} dot={{ r: 3 }} /><Line connectNulls={false} dataKey="used" name="Used U" stroke="#fb923c" strokeWidth={2.5} dot={{ r: 3 }} /><Line connectNulls={false} dataKey="available" name="Available U" stroke="#34d399" strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div></Section><Section title="Rack Unit Details"><div className="overflow-x-auto"><table className="w-full min-w-[650px] border-collapse text-xs"><thead className="text-left text-[10px] uppercase tracking-wider text-slate-500"><tr>{["Month", "Total U", "Used U", "Available U", "Usage %", "Availability %"].map(label => <th key={label} className="border-b border-slate-800 px-3 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{detailRows.map(row => { const rowUsage = row.totalU > 0 ? (row.usedU / row.totalU) * 100 : null; const rowAvailability = row.totalU > 0 ? (row.availableU / row.totalU) * 100 : null; return <tr key={row.month} className="border-b border-slate-800/70 last:border-0"><td className="px-3 py-3 font-medium text-slate-300">{monthLabelLong(row.month, "en")}</td><td className="px-3 py-3 font-mono text-slate-100">{formatFixedNumber(row.totalU, 1)}</td><td className="px-3 py-3 font-mono text-orange-300">{formatFixedNumber(row.usedU, 1)}</td><td className="px-3 py-3 font-mono text-emerald-300">{formatFixedNumber(row.availableU, 1)}</td><td className="px-3 py-3 font-mono text-slate-200">{safePercent(rowUsage)}</td><td className="px-3 py-3 font-mono text-slate-200">{safePercent(rowAvailability)}</td></tr>; })}</tbody></table>{detailRows.length === 0 && <p className="py-5 text-center text-sm text-slate-500">No Rack Unit Capacity records are available for this range.</p>}</div></Section><p className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs leading-relaxed text-slate-400">Note: Available U represents physical rack space only; actual deployment capacity depends on power, cooling, weight, and contiguous space availability.</p><RackUnitImage provider={imageProvider} facilityName={facilityName} month={month} /></div>;
}

export function WebRackUnitCapacityDashboard({ siteName, month, rackCapacityHistory, rackUnitCapacity, imageProvider }: { siteName: string | null; month: string; rackCapacityHistory: RackCapacityHistoryRow[]; rackUnitCapacity: RackUnitCapacityRow[]; imageProvider?: Pick<IDataProvider, "getRackUnitCapacityImage"> | null }) {
  return <RackCapacityProvider key={`${siteName ?? ""}:${month}`} lang="en" facilityName={siteName} initialReportingMonth={month} rackCapacity={null} rackUnitCapacity={rackUnitCapacity} rackCapacityHistory={rackCapacityHistory}><RackUnitCapacityDashboardInner month={month} facilityName={siteName} imageProvider={imageProvider} /></RackCapacityProvider>;
}
