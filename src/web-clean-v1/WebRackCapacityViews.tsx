import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, AlertTriangle, ArrowRight, BarChart3, Boxes, CheckCircle2, Clock3, Gauge, ImagePlus, Info, MapPin, Server, ShieldCheck, TrendingUp, Wrench } from "lucide-react";
import type { IDataProvider } from "../data/IDataProvider";
import type { StoredImageMeta } from "../storage/ImageStorageProvider";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { calculateRackCapacityMetrics, rackUtilizationLevel } from "../utils/rackCapacity";
import { formatFixedNumber, formatFixedPercentage } from "../utils/numberFormat";
import { formatTimestamp } from "../utils";
import { findPreviousRackUnitCapacityRow } from "../utils/rackUnitCapacity";
import { monthLabelLong, monthLabelShort } from "../utils/monthUtils";
import { RackCapacityProvider, useRackCapacity } from "../components/rack/RackCapacityContext";
import { useReport } from "../ReportContext";
import TrendLineChart from "../components/TrendLineChart";
import { calendarMonthsForTrendRange, TREND_RANGE_OPTIONS, type TrendRange } from "../utils/trendRange";
import ViewStatePanel from "../components/ViewStatePanel";
import type { RackApiSnapshot } from "./WebRackCapacityEditors";
import type { AppLanguage } from "./theme";
import { rackSummaryFromSnapshot } from "./rackCapacityPresentation";

const STATUS_COLORS = {
  inUse: "var(--semantic-energy)",
  available: "var(--semantic-availability)",
  reserved: "var(--semantic-info)",
  pending: "var(--semantic-attention)",
  other: "var(--semantic-neutral)"
} as const;
const UTILIZATION_TOOLTIP = "Normal: < 80% · Attention: 80–84.9% · High: ≥ 85%";

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
  return <div className="space-y-4"><div className="flex h-8 w-full overflow-hidden rounded-lg bg-slate-800" aria-label="Overall Rack Capacity Mix">{items.map(item => <div key={item.key} title={`${item.label}: ${formatFixedNumber(item.count, 0)} (${safePercent(ratioPercent(item.ratio))})`} style={{ width: `${metrics.total > 0 ? (item.count / metrics.total) * 100 : 0}%`, backgroundColor: item.color }} />)}</div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map(item => <div key={item.key} className="flex items-center justify-between gap-3 text-xs"><span className="inline-flex min-w-0 items-center gap-2 text-slate-300"><i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />{item.label}</span><span className="font-mono text-slate-100">{formatFixedNumber(item.count, 0)} <span className="text-slate-500">({safePercent(ratioPercent(item.ratio))})</span></span></div>)}</div></div>;
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

function levelColors(level: ReturnType<typeof rackUtilizationLevel>) {
  if (level === "High") return { text: "text-rose-300", border: "border-rose-500/50", bg: "bg-rose-500/10", solid: "#fb7185" };
  if (level === "Attention") return { text: "text-amber-300", border: "border-amber-500/50", bg: "bg-amber-500/10", solid: "#f59e0b" };
  return { text: "text-emerald-300", border: "border-emerald-500/50", bg: "bg-emerald-500/10", solid: "#34d399" };
}

function RackHeroBackground() {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[22px]">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_20%,rgba(79,70,229,0.22),transparent_32%),linear-gradient(110deg,rgba(2,6,23,0.2),rgba(2,6,23,0.82))]" />
    <svg className="absolute -right-8 bottom-0 h-full w-[52%] opacity-35" viewBox="0 0 520 220" preserveAspectRatio="xMidYMax meet">
      <defs>
        <linearGradient id="rackHeroFill" x1="0" x2="1">
          <stop offset="0%" stopColor="#0f2b50" />
          <stop offset="100%" stopColor="#07172d" />
        </linearGradient>
      </defs>
      {[0, 72, 144, 216, 288, 360].map((x, index) => <g key={x} transform={`translate(${x} ${index % 2 ? 8 : 0})`}>
        <rect x="18" y="38" width="58" height="174" rx="4" fill="url(#rackHeroFill)" stroke="#2563eb" strokeOpacity="0.55" />
        <rect x="25" y="50" width="44" height="148" rx="2" fill="#061325" stroke="#38bdf8" strokeOpacity="0.2" />
        {Array.from({ length: 12 }).map((_, slot) => <g key={slot}>
          <rect x="30" y={56 + slot * 11} width="34" height="6" rx="1" fill={slot % 4 === 0 ? "#0f766e" : "#123258"} opacity="0.8" />
          <circle cx="59" cy={59 + slot * 11} r="1.2" fill={slot % 3 === 0 ? "#22d3ee" : "#3b82f6"} />
        </g>)}
      </g>)}
    </svg>
  </div>;
}

function OperationalHealthCard({ icon: Icon, value, label, accent, tone = "slate" }: { icon: LucideIcon; value: string; label: string; accent: string; tone?: "slate" | "rose" | "amber" | "teal" | "blue" }) {
  const toneClass = {
    slate: "border-slate-700/80 bg-slate-950/35",
    rose: "border-rose-500/45 bg-rose-500/10",
    amber: "border-amber-500/45 bg-amber-500/10",
    teal: "border-teal-500/45 bg-teal-500/10",
    blue: "border-blue-500/45 bg-blue-500/10"
  }[tone];
  return <article className={`group rounded-xl border p-4 transition-transform duration-200 hover:-translate-y-0.5 ${toneClass}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="rounded-lg p-2.5" style={{ color: accent, backgroundColor: `${accent}18` }}><Icon className="h-5 w-5" /></div>
      <ArrowRight className="h-4 w-4 text-slate-600 transition-transform group-hover:translate-x-0.5" />
    </div>
    <p className="mt-4 font-mono text-3xl font-bold" style={{ color: accent }}>{value}</p>
    <p className="mt-1 text-xs leading-relaxed text-slate-400">{label}</p>
  </article>;
}

function ZoneHealthCards({ metrics }: { metrics: ReturnType<typeof calculateRackCapacityMetrics> }) {
  return <section data-testid="rack-zone-health" className="rounded-2xl border border-slate-800/80 bg-slate-900/75 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.24)]">
    <div className="mb-4 flex items-center gap-2"><Boxes className="h-5 w-5 text-indigo-400" /><h3 className="font-display text-base font-bold text-slate-100">Zone Health Overview</h3></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.zoneMetrics.map(zone => {
      const usage = ratioPercent(zone.inUse.ratio);
      const level = rackUtilizationLevel(usage);
      const colors = levelColors(level);
      const zoneLabel = zone.zone.replace(/^zone\s+/iu, "").trim() || zone.zone;
      return <article key={zone.zone} className={`relative overflow-hidden rounded-xl border p-4 ${colors.border} ${colors.bg}`}>
        <div className="absolute right-0 top-0 h-20 w-20 rounded-full opacity-10 blur-2xl" style={{ backgroundColor: colors.solid }} />
        <div className="relative flex items-center justify-between"><span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300"><Server className="h-4 w-4" />Zone {zoneLabel}</span><ArrowRight className="h-4 w-4 text-slate-500" /></div>
        <div className="relative mt-4 flex items-center gap-2"><span className={`font-mono text-3xl font-bold ${colors.text}`}>{safePercent(usage)}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${colors.border} ${colors.text}`}>{level}</span></div>
        <p className="relative mt-3 text-sm"><span className="font-mono font-semibold text-teal-300">{zone.available.count}</span> <span className="text-slate-400">racks available</span></p>
        <p className="relative mt-1 text-[11px] text-slate-500">{zone.total} total racks · {zone.inUse.count} in use</p>
      </article>;
    })}</div>
  </section>;
}

function AvailableDeploymentCard({ metrics }: { metrics: ReturnType<typeof calculateRackCapacityMetrics> }) {
  return <section className="rounded-2xl border border-teal-500/25 bg-gradient-to-br from-teal-500/10 via-slate-900/90 to-slate-900 p-5">
    <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-teal-300" /><h3 className="font-display text-base font-bold text-slate-100">Available for Deployment</h3></div>
    <div className="mt-5 flex items-end gap-3"><span className="font-mono text-4xl font-bold text-teal-300">{metrics.available.count}</span><span className="pb-1 text-sm text-slate-400">racks across {metrics.zoneMetrics.filter(zone => zone.available.count > 0).length} zones</span></div>
    <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{metrics.zoneMetrics.map(zone => {
      const label = zone.zone.replace(/^zone\s+/iu, "").trim() || zone.zone;
      const available = zone.available.count;
      return <div key={zone.zone} className={`rounded-xl border px-3 py-3 text-center ${available > 0 ? "border-teal-500/35 bg-teal-500/10" : "border-rose-500/35 bg-rose-500/10"}`}>
        <p className={`text-xs font-bold ${available > 0 ? "text-teal-300" : "text-rose-300"}`}>{label}</p>
        <p className={`mt-1 font-mono text-2xl font-bold ${available > 0 ? "text-teal-200" : "text-rose-200"}`}>{available}</p>
      </div>;
    })}</div>
  </section>;
}

function ZoneBreakdown({ metrics }: { metrics: ReturnType<typeof calculateRackCapacityMetrics> }) {
  return <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/80 shadow-[0_18px_50px_rgba(2,6,23,0.2)]">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4"><div><div className="flex items-center gap-2"><MapPin className="h-5 w-5 text-indigo-400" /><h3 className="font-display text-base font-bold text-slate-100">Rack Zone Breakdown</h3></div><p className="mt-1 text-[11px] text-slate-500">{UTILIZATION_TOOLTIP}</p></div></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[820px] border-collapse text-xs"><thead className="bg-slate-950/35 text-left text-[10px] uppercase tracking-wider text-slate-500"><tr>{["Zone", "Total Racks", "In Use", "Available", "Reserved", "Pending Dismantle", "Utilization"].map(label => <th key={label} className="border-b border-slate-800 px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{metrics.zoneMetrics.map(zone => {
      const usage = ratioPercent(zone.inUse.ratio);
      const level = rackUtilizationLevel(usage);
      const colors = levelColors(level);
      const zoneLabel = zone.zone.replace(/^zone\s+/iu, "").trim() || zone.zone;
      return <tr key={zone.zone} className={`border-b border-slate-800/70 last:border-0 ${level === "High" ? "bg-rose-500/[0.035]" : ""}`}>
        <td className="px-4 py-3"><span className={`inline-flex min-w-9 justify-center rounded-md border px-2 py-1 font-mono font-bold ${colors.border} ${colors.text} ${colors.bg}`}>{zoneLabel}</span></td>
        <td className="px-4 py-3 font-mono font-semibold text-slate-200">{zone.total}</td>
        <td className="px-4 py-3"><div className="font-mono font-semibold text-indigo-200">{zone.inUse.count}</div><div className="mt-1.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${clampPercent(ratioPercent(zone.inUse.ratio))}%` }} /></div></td>
        <td className="px-4 py-3 font-mono font-semibold text-teal-300">{zone.available.count}</td>
        <td className="px-4 py-3 font-mono font-semibold text-blue-300">{zone.reserved.count}</td>
        <td className="px-4 py-3 font-mono font-semibold text-amber-300">{zone.pendingDismantle.count}</td>
        <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="font-mono font-semibold text-slate-100">{safePercent(usage)}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${colors.border} ${colors.text} ${colors.bg}`}>{level}</span></div><div className="mt-1.5 h-1.5 w-full max-w-44 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full" style={{ width: `${clampPercent(usage)}%`, backgroundColor: colors.solid }} /></div></td>
      </tr>;
    })}</tbody></table></div>{metrics.zoneMetrics.length === 0 && <p className="py-5 text-center text-sm text-slate-500">No rack zones exist for this month.</p>}
  </section>;
}

function RackMiniTrends({ rows }: { rows: RackCapacityHistoryRow[] }) {
  const trendRows = rows.slice(-6);
  const labels = trendRows.map(row => monthLabelShort(row.snapshotMonth, "en"));
  const totals = trendRows.map(row => row.inUse + row.available + row.reserved + row.pendingDismantle);
  const usage = trendRows.map((row, index) => totals[index] > 0 ? (row.inUse / totals[index]) * 100 : null);
  const available = trendRows.map(row => row.available);
  const pending = trendRows.map(row => row.pendingDismantle);
  const cards = [
    { title: "Overall Rack Utilization Trend", icon: Activity, color: "#fb7185", unit: "%", values: usage },
    { title: "Available Rack Trend", icon: TrendingUp, color: "#2dd4bf", unit: "racks", values: available },
    { title: "Pending Dismantle Trend", icon: Wrench, color: "#f59e0b", unit: "racks", values: pending }
  ];
  return <div className="grid gap-4 xl:grid-cols-3">{cards.map(card => <section key={card.title} className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-4"><div className="mb-3 flex items-center gap-2"><card.icon className="h-4 w-4" style={{ color: card.color }} /><h3 className="text-sm font-bold text-slate-200">{card.title}</h3></div>{labels.length >= 2 ? <TrendLineChart labels={labels} unit={card.unit} height={190} compact minPointSlots={6} series={[{ name: card.title, color: card.color, values: card.values }]} /> : <div className="flex h-40 items-center justify-center text-xs text-slate-500">Not enough saved history for this trend.</div>}</section>)}</div>;
}

function RackCapacityDashboardInner({ month, history }: { month: string; history: RackCapacityHistoryRow[] }) {
  const { metrics } = useRackCapacity();
  const totalHistory = [...history].filter(row => row.rackZone === "(Total)").sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth));
  const updatedAt = history.find(row => row.snapshotMonth === month && row.rackZone === "(Total)")?.generatedAt;
  const usage = ratioPercent(metrics.inUse.ratio);
  const usageLevel = rackUtilizationLevel(usage);
  const usageColors = levelColors(usageLevel);
  const qualifyingZones = metrics.zoneMetrics.filter(zone => (ratioPercent(zone.inUse.ratio) ?? 0) >= 85);
  const highestPending = [...metrics.zoneMetrics].sort((a, b) => b.pendingDismantle.count - a.pendingDismantle.count)[0];
  const highestUtilized = [...metrics.zoneMetrics].sort((a, b) => (ratioPercent(b.inUse.ratio) ?? -1) - (ratioPercent(a.inUse.ratio) ?? -1))[0];
  const pct = (ratio: number | null) => safePercent(ratioPercent(ratio));
  const heroProgress = clampPercent(usage);
  return <div data-testid="rack-capacity-dashboard-v3" className="space-y-5">
    <div className="rounded-[26px] border border-slate-800/80 bg-[#061427] p-3 shadow-[0_28px_90px_rgba(2,6,23,0.4)] sm:p-5">
      <header className="relative min-h-[245px] overflow-hidden rounded-[22px] border border-blue-500/20 bg-[#081b33] p-5 sm:p-7">
        <RackHeroBackground />
        <div className="relative z-10 flex h-full flex-col justify-between gap-8 xl:flex-row xl:items-center">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3"><div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 p-2.5 text-cyan-300"><Server className="h-6 w-6" /></div><div><h2 className="font-display text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">Rack Capacity &amp; Utilization — {monthLabelLong(month, "en")}</h2><p className="mt-1 text-sm text-slate-400">Rack capacity, status and utilization summary</p></div></div>
            <div className="mt-8 flex flex-wrap items-end gap-5">
              <div className="relative grid h-36 w-36 place-items-center rounded-full" style={{ background: `conic-gradient(${usageColors.solid} ${heroProgress}%, #17304e ${heroProgress}% 100%)` }}><div className="grid h-[108px] w-[108px] place-items-center rounded-full border border-slate-700/70 bg-[#071629] text-center"><div><p className="font-mono text-3xl font-bold text-slate-50">{safePercent(usage)}</p><p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">Overall Utilization</p></div></div></div>
              <div className="min-w-[240px] flex-1"><div className="flex flex-wrap items-center gap-3"><h3 className="font-display text-xl font-bold text-slate-100">Overall Rack Utilization</h3><span className={`rounded-full border px-3 py-1 text-xs font-bold ${usageColors.border} ${usageColors.bg} ${usageColors.text}`}>{usageLevel}</span></div><p className="mt-2 text-base text-slate-300"><span className="font-mono font-semibold text-slate-50">{metrics.inUse.count}</span> of <span className="font-mono font-semibold text-slate-50">{metrics.total}</span> racks are in use</p><div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800/90"><div className="h-full rounded-full shadow-[0_0_18px_currentColor]" style={{ width: `${heroProgress}%`, backgroundColor: usageColors.solid, color: usageColors.solid }} /></div><p className="mt-2 text-[11px] text-slate-500">{UTILIZATION_TOOLTIP}</p></div>
            </div>
          </div>
          <div className="hidden max-w-[250px] rounded-2xl border border-blue-400/15 bg-blue-950/45 p-5 backdrop-blur-sm xl:block"><BarChart3 className="h-7 w-7 text-blue-400" /><p className="mt-3 text-sm font-semibold text-slate-200">Capacity at a glance</p><p className="mt-2 text-xs leading-relaxed text-slate-400">{metrics.available.count} racks are immediately available; {qualifyingZones.length} zone{qualifyingZones.length === 1 ? "" : "s"} are at or above 85% utilization.</p></div>
        </div>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={Server} label="Total Racks" value={formatFixedNumber(metrics.total, 0)} sub="Physical rack positions" accent="#64748b" sparkline={totalHistory.map(row => row.inUse + row.available + row.reserved + row.pendingDismantle)} />
        <MetricCard icon={Activity} label="In Use" value={formatFixedNumber(metrics.inUse.count, 0)} sub={`${pct(metrics.inUse.ratio)} of total`} accent="#6366f1" sparkline={totalHistory.map(row => row.inUse)} />
        <MetricCard icon={CheckCircle2} label="Available" value={formatFixedNumber(metrics.available.count, 0)} sub={`${pct(metrics.available.ratio)} of total`} accent="#14b8a6" sparkline={totalHistory.map(row => row.available)} />
        <MetricCard icon={Clock3} label="Reserved" value={formatFixedNumber(metrics.reserved.count, 0)} sub={`${pct(metrics.reserved.ratio)} of total`} accent="#3b82f6" sparkline={totalHistory.map(row => row.reserved)} />
        <MetricCard icon={AlertTriangle} label="Pending Dismantle" value={formatFixedNumber(metrics.pendingDismantle.count, 0)} sub={`${pct(metrics.pendingDismantle.ratio)} of total`} accent="#f59e0b" sparkline={totalHistory.map(row => row.pendingDismantle)} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-5"><h3 className="font-display text-base font-bold text-slate-100">Overall Capacity Mix</h3><div className="mt-5"><CapacityMix metrics={metrics} /></div></section>
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/80 p-5"><h3 className="font-display text-base font-bold text-slate-100">Operational Health</h3><div className="mt-4 grid gap-3 sm:grid-cols-2">
          <OperationalHealthCard icon={ShieldCheck} value={String(metrics.available.count)} label="Racks available for deployment" accent="#2dd4bf" tone="teal" />
          <OperationalHealthCard icon={AlertTriangle} value={String(qualifyingZones.length)} label="Zones at or above 85% utilization" accent="#fb7185" tone="rose" />
          <OperationalHealthCard icon={Wrench} value={String(metrics.pendingDismantle.count)} label="Racks pending dismantle" accent="#f59e0b" tone="amber" />
          <OperationalHealthCard icon={Gauge} value={highestUtilized ? highestUtilized.zone.replace(/^zone\s+/iu, "") : "—"} label={highestUtilized ? `Highest risk zone (${safePercent(ratioPercent(highestUtilized.inUse.ratio))} utilized)` : "No zone utilization data"} accent="#60a5fa" tone="blue" />
        </div>{highestPending && highestPending.pendingDismantle.count > 0 && <p className="mt-3 text-[11px] text-slate-500">{highestPending.zone} has the highest pending dismantle count ({highestPending.pendingDismantle.count} racks).</p>}</section>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_0.75fr]"><ZoneHealthCards metrics={metrics} /><AvailableDeploymentCard metrics={metrics} /></div>
      <div className="mt-4"><ZoneBreakdown metrics={metrics} /></div>
      <div className="mt-4"><RackMiniTrends rows={totalHistory} /></div>
      <footer className="mt-4 flex flex-col gap-2 rounded-xl border border-slate-800/80 bg-slate-950/45 px-4 py-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>Source: Production API · Snapshot: {monthLabelLong(month, "en")}</span><span>Last updated: {safeDate(updatedAt)}</span></footer>
    </div>
  </div>;
}

export function WebRackCapacityDashboard({ siteId, siteName, month, snapshot, rackCapacityHistory, rackUnitCapacity, onGoToEntry }: { siteId: number; siteName: string | null; month: string; snapshot: RackApiSnapshot | null; rackCapacityHistory: RackCapacityHistoryRow[]; rackUnitCapacity: RackUnitCapacityRow[]; onGoToEntry?: () => void }) {
  if (!snapshot) return <ViewStatePanel kind="empty" title={`No confirmed Rack Capacity snapshot for ${monthLabelLong(month, "en")}.`} detail="Review or confirm this reporting month in Monthly Data Entry." action={onGoToEntry ? { label: "Go to Monthly Data Entry", onClick: onGoToEntry } : undefined} />;
  return <RackCapacityProvider key={siteId + ":" + month} lang="en" facilityName={siteName} initialReportingMonth={month} rackCapacity={rackSummaryFromSnapshot(snapshot)} rackUnitCapacity={rackUnitCapacity} rackCapacityHistory={rackCapacityHistory}><RackCapacityDashboardInner month={month} history={rackCapacityHistory} /></RackCapacityProvider>;
}


function UCapacityMix({ total, used, available, hasData }: { total: number; used: number; available: number; hasData?: boolean }) {
  const usedWidth = total > 0 ? clampPercent((used / total) * 100) : 0;
  const availableWidth = total > 0 ? clampPercent((Math.max(0, available) / total) * 100) : 0;
  const hasCapacityData = hasData ?? total > 0;
  if (!hasCapacityData) return <div className="space-y-4"><div className="flex h-8 items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-500">No monthly Rack Unit Capacity snapshot</div><p className="text-xs text-slate-500">Capacity mix is unavailable for the selected Reporting Month.</p></div>;
  const usagePct = total > 0 ? (used / total) * 100 : null;
  return <div className="space-y-4"><div className="flex h-8 overflow-hidden rounded-lg bg-slate-800"><div className="h-full bg-orange-400" style={{ width: `${usedWidth}%` }} /><div className="h-full bg-emerald-400" style={{ width: `${availableWidth}%` }} /></div><div className="grid gap-3 sm:grid-cols-2"><div className="flex items-center justify-between text-xs"><span className="inline-flex items-center gap-2 text-slate-300"><i className="h-2.5 w-2.5 rounded-full bg-orange-400" />Used ({formatFixedNumber(used, 0)} U)</span><span className="font-mono text-slate-100">{safePercent(usagePct)}</span></div><div className="flex items-center justify-between text-xs"><span className="inline-flex items-center gap-2 text-slate-300"><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Available ({formatFixedNumber(Math.max(0, available), 0)} U)</span><span className="font-mono text-slate-100">{safePercent(usagePct === null ? null : 100 - usagePct)}</span></div></div><div className="border-t border-slate-800 pt-3 text-xs text-slate-400">You are using <span className="font-mono text-slate-200">{safePercent(usagePct)}</span> of total capacity. Available capacity is <span className="font-mono text-slate-200">{formatFixedNumber(Math.max(0, available), 0)} U</span>.</div></div>;
}

function HealthGauge({ usage }: { usage: number | null }) {
  const level = usage === null ? null : rackUtilizationLevel(usage);
  const color = level === "High" ? "#fb7185" : level === "Attention" ? "#f59e0b" : level === "Normal" ? "#34d399" : "#64748b";
  return <div className="relative h-36"><svg className="h-full w-full" viewBox="0 0 200 115" role="img" aria-label={`Capacity health ${safePercent(usage)}`}><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#1e293b" strokeLinecap="round" strokeWidth="18" /><path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" pathLength="100" stroke={color} strokeDasharray={`${clampPercent(usage)} 100`} strokeLinecap="round" strokeWidth="18" /></svg><div className="pointer-events-none absolute inset-x-0 bottom-0 text-center"><p className="font-mono text-3xl font-semibold" style={{ color }}>{safePercent(usage)}</p><p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{level ? `${level} Utilization` : "Unavailable"}</p></div></div>;
}

function RackUnitImage({ provider, facilityName, month }: { provider?: Pick<IDataProvider, "getRackUnitCapacityImage"> | null; facilityName: string | null; month: string }) {
  const [image, setImage] = useState<{ dataUri: string; meta: StoredImageMeta } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    if (!provider?.getRackUnitCapacityImage) { setImage(null); return; }
    setLoading(true);
    provider.getRackUnitCapacityImage(facilityName ?? "", month)
      .then(result => { if (!cancelled) setImage(result ? { dataUri: result.dataUri, meta: result.meta } : null); })
      .catch(() => { if (!cancelled) { setImage(null); setError(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [facilityName, month, provider]);
  return <Section title="Monthly Rack Unit Capacity Image"><div className="min-h-[240px]">{loading ? <div className="flex h-60 items-center justify-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-500">Loading Monthly Rack Unit Capacity Image…</div> : error ? <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-700 text-center text-slate-500"><AlertTriangle className="h-7 w-7 text-amber-400" /><p className="text-sm">Unable to load Monthly Rack Unit Capacity Image.</p></div> : image ? <figure className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950"><img src={image.dataUri} alt={`Monthly Rack Unit Capacity for ${monthLabelLong(month, "en")}`} className="max-h-[520px] w-full object-contain" /><figcaption className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-800 px-4 py-3 text-[11px] text-slate-400"><span>{monthLabelLong(month, "en")}</span><span>Last updated: {safeDate(image.meta.savedAt)}</span><span>Resolution: {image.meta.width}×{image.meta.height}px</span><span>Captured by: {image.meta.savedBy}</span></figcaption></figure> : <div className="flex h-60 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-700 text-center text-slate-500"><ImagePlus className="h-7 w-7" /><p className="text-sm">No Monthly Rack Unit Capacity Image is available for this reporting month.</p></div>}</div></Section>;
}

function RackUnitCapacityDashboardInner({ month, facilityName, imageProvider, history, lang }: { month: string; facilityName: string | null; imageProvider?: Pick<IDataProvider, "getRackUnitCapacityImage"> | null; history: RackCapacityHistoryRow[]; lang: AppLanguage }) {
  const { rackUnitCapacity, unitCapacityRow } = useRackCapacity();
  const { selectedTrend, setSelectedTrend } = useReport();
  const activeTrendRange: TrendRange = TREND_RANGE_OPTIONS.includes(selectedTrend as TrendRange) ? selectedTrend as TrendRange : "Last 6 Months";
  const total = unitCapacityRow?.totalU ?? 0;
  const used = unitCapacityRow?.usedU ?? 0;
  const available = unitCapacityRow ? total - used : 0;
  const usage = unitCapacityRow && total > 0 ? (used / total) * 100 : null;
  const availability = unitCapacityRow && total > 0 ? (available / total) * 100 : null;
  const previous = useMemo(() => findPreviousRackUnitCapacityRow(rackUnitCapacity, month), [month, rackUnitCapacity]);
  const previousUsage = previous && previous.totalU > 0 ? (previous.usedU / previous.totalU) * 100 : null;
  const trendPoints = usage !== null && previousUsage !== null ? usage - previousUsage : null;
  const trendLabel = trendPoints === null ? (unitCapacityRow ? "No prior month" : "No current month data") : `${trendPoints >= 0 ? "▲" : "▼"} ${formatFixedNumber(Math.abs(trendPoints), 1)} pp vs previous month`;
  const trendMonths = useMemo(() => calendarMonthsForTrendRange(rackUnitCapacity.map(row => row.month), month, activeTrendRange), [activeTrendRange, month, rackUnitCapacity]);
  const byMonth = useMemo(() => new Map(rackUnitCapacity.map(row => [row.month, row] as const)), [rackUnitCapacity]);
  const trendData = trendMonths.map(targetMonth => { const row = byMonth.get(targetMonth); return { month: monthLabelShort(targetMonth, "en"), total: row ? row.totalU : null, used: row ? row.usedU : null, available: row ? row.availableU : null }; });
  const detailRows = trendMonths.map(targetMonth => byMonth.get(targetMonth) ?? null).filter((row): row is RackUnitCapacityRow => row !== null);
  const dataAsOf = history.find(row => row.snapshotMonth === month && row.rackZone === "(Total)")?.generatedAt;
  const ofTotal = (part: number) => unitCapacityRow && total > 0 ? `${safePercent((part / total) * 100)} of Total` : undefined;
  return <div className="space-y-5"><div className="space-y-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 shadow-sm sm:p-6"><header className="rounded-xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-300"><Boxes className="h-5 w-5" /></div><div><h2 className="font-display text-2xl font-bold tracking-tight text-slate-100">Rack Unit Capacity &amp; Utilization <span className="text-blue-400">• {monthLabelLong(month, "en")}</span></h2><p className="mt-1 text-sm text-slate-400">Read-only Rack Unit Capacity (U) executive summary</p><span data-view-state="readonly" className="mt-2 inline-flex rounded-full border border-teal-500/25 bg-teal-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-teal-300">Read-only</span></div></div><div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">Data as of <span className="font-mono text-slate-300">{dataAsOf ? safeDate(dataAsOf) : monthLabelLong(month, "en")}</span></div></div></header><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"><MetricCard icon={Boxes} label="Total U" value={formatFixedNumber(unitCapacityRow ? total : null, 0)} sub="U" accent="#60a5fa" /><MetricCard icon={TrendingUp} label="Used U" value={formatFixedNumber(unitCapacityRow ? used : null, 0)} sub={ofTotal(used)} accent="#fb923c" /><MetricCard icon={CheckCircle2} label="Available U" value={formatFixedNumber(unitCapacityRow ? available : null, 0)} sub={ofTotal(Math.max(0, available))} accent="#34d399" /><MetricCard icon={Gauge} label="Usage %" value={safePercent(usage)} accent="#f59e0b" /><MetricCard icon={ShieldCheck} label="Availability %" value={safePercent(availability)} accent="#2dd4bf" /></div><div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]"><Section title="Overall U Capacity Mix"><UCapacityMix total={total} used={used} available={available} /></Section><Section title="Capacity Health"><HealthGauge usage={usage} /><div className="mt-2 grid gap-2 text-xs sm:grid-cols-2"><div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3"><p className="text-slate-500">Available capacity</p><p className="mt-1 font-mono text-slate-100">{formatFixedNumber(unitCapacityRow ? available : null, 0)} U</p></div><div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3"><p className="text-slate-500">Trend vs previous month</p><p className={`mt-1 font-mono ${trendPoints !== null && trendPoints > 0 ? "text-rose-300" : "text-emerald-300"}`}>{trendLabel}</p></div></div></Section></div><Section title="Rack Unit Capacity Trend"><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-slate-500">Select trend period</p><div data-testid="rack-unit-trend-range" className="grid grid-cols-4 gap-1 rounded-xl border border-slate-800 bg-slate-950/60 p-1">{TREND_RANGE_OPTIONS.map(option => { const label = option === "All" ? "All" : option.replace("Last ", "").replace(" Months", "M"); return <button key={option} type="button" onClick={() => setSelectedTrend(option)} className={`min-h-9 rounded-lg px-2 text-[10px] font-bold transition-colors ${activeTrendRange === option ? "bg-indigo-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"}`}>{label}</button>; })}</div></div><TrendLineChart labels={trendData.map(row => row.month)} unit="U" height={300} compact minPointSlots={12} series={[{ name: "Total U", color: "#60a5fa", values: trendData.map(row => row.total) }, { name: "Used U", color: "#fb923c", values: trendData.map(row => row.used) }, { name: "Available U", color: "#34d399", values: trendData.map(row => row.available) }]} /><p data-testid="rack-unit-capacity-trend-note" className="mt-3 border-t border-slate-800 pt-3 text-xs leading-relaxed text-slate-400">{lang === "th" ? "หมายเหตุแนวโน้มความจุ Rack Unit: Available U แสดงเฉพาะพื้นที่ว่างทางกายภาพภายใน Rack เท่านั้น ความสามารถในการติดตั้งอุปกรณ์จริงยังขึ้นอยู่กับกำลังไฟฟ้า ระบบทำความเย็น น้ำหนัก และความต่อเนื่องของพื้นที่ว่างภายใน Rack" : "Rack Unit Capacity Trend Note: Available U represents physical rack space only; actual deployment capacity depends on power, cooling, weight, and contiguous space availability."}</p></Section><footer className="flex flex-col gap-1 border-t border-slate-800 pt-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between"><span>U (Rack Unit) = Standard unit of vertical space in a rack. 1U = 1.75 inches.</span><span className="font-mono text-slate-400">Source: Production API</span></footer></div><Section title="Rack Unit Details"><div className="overflow-x-auto"><table className="w-full min-w-[650px] border-collapse text-xs"><thead className="text-left text-[10px] uppercase tracking-wider text-slate-500"><tr>{["Month", "Total U", "Used U", "Available U", "Usage %", "Availability %"].map(label => <th key={label} className="border-b border-slate-800 px-3 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{detailRows.map(row => { const rowUsage = row.totalU > 0 ? (row.usedU / row.totalU) * 100 : null; const rowAvailability = row.totalU > 0 ? (row.availableU / row.totalU) * 100 : null; return <tr key={row.month} className="border-b border-slate-800/70 last:border-0"><td className="px-3 py-3 font-medium text-slate-300">{monthLabelLong(row.month, "en")}</td><td className="px-3 py-3 font-mono text-slate-100">{formatFixedNumber(row.totalU, 0)}</td><td className="px-3 py-3 font-mono text-orange-300">{formatFixedNumber(row.usedU, 0)}</td><td className="px-3 py-3 font-mono text-emerald-300">{formatFixedNumber(row.availableU, 0)}</td><td className="px-3 py-3 font-mono text-slate-200">{safePercent(rowUsage)}</td><td className="px-3 py-3 font-mono text-slate-200">{safePercent(rowAvailability)}</td></tr>; })}</tbody></table>{detailRows.length === 0 && <p className="py-5 text-center text-sm text-slate-500">No Rack Unit Capacity records are available for this range.</p>}</div></Section><RackUnitImage provider={imageProvider} facilityName={facilityName} month={month} /></div>;
}

export function WebRackUnitCapacityDashboard({ siteName, month, rackCapacityHistory, rackUnitCapacity, imageProvider, lang }: { siteName: string | null; month: string; rackCapacityHistory: RackCapacityHistoryRow[]; rackUnitCapacity: RackUnitCapacityRow[]; imageProvider?: Pick<IDataProvider, "getRackUnitCapacityImage"> | null; lang: AppLanguage }) {
  return <RackCapacityProvider key={`${siteName ?? ""}:${month}`} lang={lang} facilityName={siteName} initialReportingMonth={month} rackCapacity={null} rackUnitCapacity={rackUnitCapacity} rackCapacityHistory={rackCapacityHistory}><RackUnitCapacityDashboardInner month={month} facilityName={siteName} imageProvider={imageProvider} history={rackCapacityHistory} lang={lang} /></RackCapacityProvider>;
}
