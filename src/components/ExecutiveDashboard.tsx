import { useEffect, useMemo, useState } from "react";
import { Coins, Download, Gauge, RefreshCw, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { useReport } from "../ReportContext";
import type { MonthlyLog } from "../types";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { calculateEnergyCostForMonth } from "../utils/energyCost";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { shiftMonth } from "../utils/monthUtils";
import { selectedDashboardMonth } from "../utils/reportPeriodSelection";
import EngineeringTrendCharts from "./EngineeringTrendCharts";
import ExecutiveCapacityOverview from "./ExecutiveCapacityOverview";
import ViewStatePanel from "./ViewStatePanel";

interface ExecutiveDashboardProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
  /** Web passes the global Reporting Month explicitly. Desktop stays
   * backward-compatible and resolves the month from ReportContext. */
  selectedMonth?: string;
  facilityName?: string;
  sourceLabel?: string;
  rackCapacityHistory?: RackCapacityHistoryRow[];
  rackUnitCapacity?: RackUnitCapacityRow[];
  onViewRackCapacity?: () => void;
  onViewRackUnitCapacity?: () => void;
  onRefresh?: () => void | Promise<void>;
  onExport?: (format: "pdf" | "excel" | "csv") => void;
}

type MetricKey = "floorEnergyKwh" | "floorElectricityCostThb" | "energySharePercent" | "averageElectricityRateThbPerKwh";
type EnergyMetrics = ReturnType<typeof calculateEnergyCostForMonth>;

interface KpiDefinition {
  key: MetricKey;
  label: string;
  unit: string;
  icon: typeof Zap;
  tone: "energy" | "cost" | "share" | "rate";
  format: (value: number) => string;
}

function useDesktopLayout(): boolean {
  const query = "(min-width: 768px)";
  const [desktop, setDesktop] = useState(() => typeof window === "undefined" ? true : window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(query);
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
}

function daysInMonth(month: string): number | null {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return null;
  return new Date(year, monthNumber, 0).getDate();
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return month;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[monthNumber - 1]}-${year}`;
}

function lastUpdatedDate(log: MonthlyLog | undefined): string {
  if (!log) return "—";
  const latest = [log.lastSavedUps, log.lastSavedAir, log.lastSavedDc, log.lastSavedEnergyCost]
    .filter((value): value is string => Boolean(value))
    .map(value => ({ value, date: new Date(value) }))
    .filter(item => !Number.isNaN(item.date.getTime()))
    .sort((left, right) => right.date.getTime() - left.date.getTime())[0];
  if (!latest) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", day: "2-digit", month: "short", year: "numeric" }).formatToParts(latest.date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("day")}-${part("month")}-${part("year")}`;
}

function comparisonDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0 || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return (current - previous) / Math.abs(previous) * 100;
}

function metricValue(metrics: EnergyMetrics | null, key: MetricKey): number | null {
  const value = metrics?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function deltaBadge(key: MetricKey, current: number | null, previous: number | null, previousMonth: string): { label: string; className: string; up: boolean } | null {
  const delta = comparisonDelta(current, previous);
  if (delta === null) return null;
  const up = delta > 0;
  const neutral = key === "energySharePercent";
  const positive = !neutral && !up;
  return {
    label: `${up ? "▲" : delta < 0 ? "▼" : "•"} ${formatNumber2(Math.abs(delta))}% vs ${monthLabel(previousMonth).split("-")[0]}`,
    className: neutral ? "border-slate-700 bg-slate-800/60 text-slate-300" : positive ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300",
    up,
  };
}

function kpiTone(tone: KpiDefinition["tone"]): string {
  if (tone === "cost") return "text-emerald-400";
  if (tone === "share") return "text-teal-400";
  if (tone === "rate") return "text-blue-400";
  return "text-indigo-400";
}

function DesktopKpiCard({ definition, current, previous, previousMonth }: { definition: KpiDefinition; current: number | null; previous: number | null; previousMonth: string }) {
  const badge = deltaBadge(definition.key, current, previous, previousMonth);
  const Icon = definition.icon;
  return <article className="min-w-0 rounded-2xl border border-slate-800/70 bg-slate-900 p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{definition.label}</p>
      <Icon className={`h-5 w-5 shrink-0 ${kpiTone(definition.tone)}`} />
    </div>
    <div className="mt-5 flex flex-wrap items-end gap-2">
      <span className="break-words font-mono text-[1.75rem] font-black leading-none text-slate-100 xl:text-3xl">{current === null ? "—" : definition.format(current)}</span>
      <span className="pb-0.5 text-xs font-semibold text-slate-500">{definition.unit}</span>
    </div>
    <div className="mt-4 min-h-6">{badge ? <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold ${badge.className}`}>{badge.label}</span> : <span className="text-[10px] text-slate-600">No prior-month comparison</span>}</div>
  </article>;
}

function MobileKpiCard({ definition, current, previous, previousMonth }: { definition: KpiDefinition; current: number | null; previous: number | null; previousMonth: string }) {
  const badge = deltaBadge(definition.key, current, previous, previousMonth);
  const Icon = definition.icon;
  return <article className="min-w-0 rounded-2xl border border-slate-800/70 bg-slate-900 p-3.5 shadow-sm">
    <div className="flex items-start justify-between gap-2">
      <p className="text-[9px] font-bold uppercase leading-tight tracking-[0.08em] text-slate-400">{definition.label}</p>
      <Icon className={`h-4 w-4 shrink-0 ${kpiTone(definition.tone)}`} />
    </div>
    <p className="mt-3 break-words font-mono text-xl font-black leading-tight text-slate-100">{current === null ? "—" : definition.format(current)}</p>
    <p className="mt-1 text-[9px] font-semibold text-slate-500">{definition.unit}</p>
    <div className="mt-2 min-h-5">{badge ? <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${badge.className}`}>{badge.label}</span> : <span className="text-[8px] text-slate-600">No comparison</span>}</div>
  </article>;
}

function DesktopHeader({ facilityName, selectedMonth, days, sourceLabel, updatedAt, lang, onRefresh, onExport }: { facilityName: string; selectedMonth: string; days: number | null; sourceLabel: string; updatedAt: string; lang: "th" | "en"; onRefresh?: () => void | Promise<void>; onExport?: (format: "pdf" | "excel" | "csv") => void }) {
  return <header className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800/70 bg-slate-900/70 px-5 py-3 shadow-sm">
    <p className="min-w-0 truncate text-sm font-semibold text-slate-200">
      {facilityName} <span className="text-slate-600">·</span> {monthLabel(selectedMonth)} <span className="text-slate-600">·</span> {days ?? "—"} Days <span className="text-slate-600">·</span> {sourceLabel} <span className="text-slate-600">·</span> {lang === "th" ? "อัปเดตล่าสุด" : "Last Updated"} {updatedAt}
    </p>
    <div className="flex shrink-0 items-center gap-2">
      {onRefresh && <button type="button" onClick={() => void onRefresh()} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-indigo-500/50 hover:text-indigo-300"><RefreshCw className="h-3.5 w-3.5" />{lang === "th" ? "รีเฟรช" : "Refresh"}</button>}
      {onExport && <button type="button" onClick={() => onExport("pdf")} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500"><Download className="h-3.5 w-3.5" />{lang === "th" ? "ส่งออก" : "Export"}</button>}
    </div>
  </header>;
}

function MobileHeader({ facilityName, selectedMonth, days, sourceLabel, updatedAt, lang, onRefresh, onExport }: { facilityName: string; selectedMonth: string; days: number | null; sourceLabel: string; updatedAt: string; lang: "th" | "en"; onRefresh?: () => void | Promise<void>; onExport?: (format: "pdf" | "excel" | "csv") => void }) {
  return <header className="rounded-2xl border border-slate-800/70 bg-slate-900 p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="truncate font-display text-base font-bold text-slate-100">{facilityName}</p><p className="mt-0.5 text-xs font-semibold text-indigo-300">{monthLabel(selectedMonth)} · {days ?? "—"} Days</p></div>
      <div className="flex shrink-0 gap-1.5">
        {onRefresh && <button type="button" onClick={() => void onRefresh()} aria-label={lang === "th" ? "รีเฟรช" : "Refresh"} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-700 bg-slate-950 text-slate-300"><RefreshCw className="h-4 w-4" /></button>}
        {onExport && <button type="button" onClick={() => onExport("pdf")} aria-label={lang === "th" ? "ส่งออก" : "Export"} className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white"><Download className="h-4 w-4" /></button>}
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-800 pt-2.5 text-[10px] text-slate-500"><span>{sourceLabel}</span><span>•</span><span>{lang === "th" ? "อัปเดต" : "Updated"} {updatedAt}</span></div>
  </header>;
}

export default function ExecutiveDashboard({ logs, lang, selectedMonth: selectedMonthProp, facilityName = "Facility", sourceLabel = "Production API", rackCapacityHistory = [], rackUnitCapacity = [], onViewRackCapacity, onViewRackUnitCapacity, onRefresh, onExport }: ExecutiveDashboardProps) {
  const { selectedYear, selectedPeriod } = useReport();
  const desktop = useDesktopLayout();
  const fallbackMonth = [...logs].map(log => log.month).sort().at(-1) ?? `${selectedYear}-01`;
  const selectedMonth = selectedMonthProp ?? selectedDashboardMonth(logs, selectedYear, selectedPeriod, fallbackMonth);
  const selectedLog = logs.find(log => log.month === selectedMonth);
  const previousMonth = shiftMonth(selectedMonth, -1);
  const previousLog = logs.find(log => log.month === previousMonth);
  const currentMetrics = useMemo(() => selectedLog ? calculateEnergyCostForMonth(logs, selectedMonth) : null, [logs, selectedLog, selectedMonth]);
  const previousMetrics = useMemo(() => previousLog ? calculateEnergyCostForMonth(logs, previousMonth) : null, [logs, previousLog, previousMonth]);

  const copy = lang === "th" ? {
    empty: "ไม่มีข้อมูลของเดือนรายงานที่เลือก",
    floorEnergy: "พลังงานชั้น 4",
    floorCost: "ประมาณการค่าไฟชั้น 4",
    share: "สัดส่วนพลังงานชั้น 4",
    rate: "อัตราค่าไฟเฉลี่ย",
  } : {
    empty: "No data is available for the selected reporting month.",
    floorEnergy: "4th Floor Energy",
    floorCost: "Estimated 4th Floor Cost",
    share: "4th Floor Energy Share",
    rate: "Avg Electricity Rate",
  };

  const definitions: KpiDefinition[] = [
    { key: "floorEnergyKwh", label: copy.floorEnergy, unit: "kWh", icon: Zap, tone: "energy", format: formatNumber2 },
    { key: "floorElectricityCostThb", label: copy.floorCost, unit: "THB", icon: Coins, tone: "cost", format: value => `฿${formatNumber2(value)}` },
    { key: "energySharePercent", label: copy.share, unit: "% of building", icon: TrendingUp, tone: "share", format: value => `${formatNumber2(value)}%` },
    { key: "averageElectricityRateThbPerKwh", label: copy.rate, unit: "THB/kWh", icon: Gauge, tone: "rate", format: formatNumber2 },
  ];

  if (!selectedLog || !currentMetrics) {
    return <ViewStatePanel kind="empty" title={copy.empty} detail={lang === "th" ? "เลือกเดือนที่มีข้อมูลบันทึกเพื่อแสดง Executive Dashboard" : "Select a reporting month with persisted data to display the Executive Dashboard."} />;
  }

  const headerProps = { facilityName, selectedMonth, days: daysInMonth(selectedMonth), sourceLabel, updatedAt: lastUpdatedDate(selectedLog), lang, onRefresh, onExport };
  const kpiValues = definitions.map(definition => ({ definition, current: metricValue(currentMetrics, definition.key), previous: metricValue(previousMetrics, definition.key) }));

  if (desktop) {
    return <div className="space-y-6 animate-fadeIn" data-testid="executive-desktop-v2">
      <DesktopHeader {...headerProps} />
      <section className="grid grid-cols-4 gap-4" aria-label="Executive KPI summary">
        {kpiValues.map(item => <div key={item.definition.key}><DesktopKpiCard {...item} previousMonth={previousMonth} /></div>)}
      </section>
      <ExecutiveCapacityOverview selectedMonth={selectedMonth} rackCapacityHistory={rackCapacityHistory} rackUnitCapacity={rackUnitCapacity} lang={lang} layout="desktop" onViewRackCapacity={onViewRackCapacity} onViewRackUnitCapacity={onViewRackUnitCapacity} />
      <EngineeringTrendCharts logs={logs} lang={lang} selectedMonth={selectedMonth} layout="desktop" />
    </div>;
  }

  return <div className="space-y-4 animate-fadeIn" data-testid="executive-mobile-v2">
    <MobileHeader {...headerProps} />
    <section className="grid grid-cols-2 gap-2.5" aria-label="Executive KPI summary">
      {kpiValues.map(item => <div key={item.definition.key}><MobileKpiCard {...item} previousMonth={previousMonth} /></div>)}
    </section>
    <ExecutiveCapacityOverview selectedMonth={selectedMonth} rackCapacityHistory={rackCapacityHistory} rackUnitCapacity={rackUnitCapacity} lang={lang} layout="mobile" onViewRackCapacity={onViewRackCapacity} onViewRackUnitCapacity={onViewRackUnitCapacity} />
    <EngineeringTrendCharts logs={logs} lang={lang} selectedMonth={selectedMonth} layout="mobile" />
  </div>;
}
