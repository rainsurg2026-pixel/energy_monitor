import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, Calendar, ChevronDown, Download, Gauge, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { useReport, type BenchmarkReference } from "../ReportContext";
import type { FacilityEntry } from "../desktop";

type ReportViewId = "executive" | "dashboard" | "benchmark";
const ALL_REPORT_VIEWS: readonly ReportViewId[] = ["executive", "dashboard", "benchmark"];
const REPORT_VIEW_TABS: ReadonlyArray<{ id: ReportViewId; labelEn: string; labelTh: string }> = [
  { id: "executive", labelEn: "Executive View", labelTh: "แดชบอร์ดผู้บริหาร" },
  { id: "dashboard", labelEn: "Engineering View", labelTh: "วิเคราะห์วิศวกรรม" },
  { id: "benchmark", labelEn: "Benchmark View", labelTh: "เปรียบเทียบเกณฑ์" },
];

interface UniversalFilterBarProps {
  onExport?: (format: "pdf" | "excel" | "csv" | "png") => void;
  exportFormats?: readonly ("pdf" | "excel" | "csv" | "png")[];
  lang: "th" | "en";
  facility?: FacilityEntry | null;
  siteName?: string;
  selectedMonth?: string;
  availableMonths?: readonly string[];
  onReportingMonthChange?: (month: string) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  upsGroupNames?: readonly string[];
  reportViews?: readonly ReportViewId[];
  /** Executive owns Refresh/Export in its compact metadata header. */
  showUtilityActions?: boolean;
}

const selectClass = "w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 pr-8 text-xs font-semibold text-slate-100 outline-none transition-colors hover:border-slate-600 focus:border-indigo-500";
const labelClass = "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500";

function SelectShell({ children }: { children: ReactNode }) {
  return <div className="relative">{children}<ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" /></div>;
}

export default function UniversalFilterBar({
  onExport,
  exportFormats = ["pdf", "excel", "csv", "png"],
  lang,
  facility = null,
  siteName = "Facility",
  selectedMonth = "",
  availableMonths = [],
  onReportingMonthChange,
  onRefresh,
  upsGroupNames = [],
  reportViews = ALL_REPORT_VIEWS,
  showUtilityActions = true,
}: UniversalFilterBarProps) {
  const {
    selectedYear, selectedTrend, compareMode, selectedCategory, selectedUPSGroup, selectedReportView, availableYears,
    selectedBenchmarkReference,
    setSelectedYear, setSelectedPeriod, setSelectedTrend, setCompareMode, setSelectedCategory, setSelectedUPSGroup, setSelectedReportView,
    setSelectedBenchmarkReference, triggerRefresh,
  } = useReport();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const th = lang === "th";

  // PUE and Carbon are not Engineering categories in the current product.
  // They must not survive as hidden Engineering filters from older releases.
  useEffect(() => {
    if (selectedReportView === "dashboard" && (selectedCategory === "PUE" || selectedCategory === "Carbon")) setSelectedCategory("All");
  }, [selectedCategory, selectedReportView, setSelectedCategory]);

  const copy = th ? {
    site: "ไซต์", month: "เดือนรายงาน", view: "มุมมองรายงาน", filters: "ตัวกรอง", refresh: "รีเฟรช", export: "ส่งออก",
    trend: "ช่วงแนวโน้ม", compare: "เปรียบเทียบ", category: "หมวดหมู่", ups: "กลุ่ม UPS", benchmark: "เกณฑ์อ้างอิง", period: "ปีอ้างอิง",
    all: "ทั้งหมด", close: "ปิดตัวกรอง",
  } : {
    site: "Facility / Site", month: "Reporting Month", view: "Report View", filters: "Filters", refresh: "Refresh", export: "Export",
    trend: "Trend Range", compare: "Compare With", category: "Category", ups: "UPS Group", benchmark: "Benchmark Reference", period: "Benchmark Period",
    all: "All", close: "Close filters",
  };

  const upsGroupOptions = [
    { value: "All", label: th ? "ทุกกลุ่ม UPS" : "All UPS Groups" },
    ...(facility?.profile.dashboard.upsGroups ?? []).map(group => ({ value: group.name, label: group.name })),
    ...(facility?.profile.dashboard.upsMapping ?? []).map(mapping => ({ value: mapping.upsId, label: mapping.upsId })),
    ...upsGroupNames.map(name => ({ value: name, label: name })),
  ].filter((item, index, all) => all.findIndex(candidate => candidate.value === item.value) === index);

  const engineeringCategories = [
    { value: "All", label: th ? "ทุกหมวดหมู่" : "All Categories" },
    { value: "UPS", label: "UPS" },
    { value: "Air Conditioning", label: th ? "ระบบปรับอากาศ" : "Air Conditioning" },
    { value: "DC", label: "DC Power" },
    { value: "Energy Cost", label: th ? "พลังงานและค่าไฟ" : "Energy & Cost" },
  ] as const;

  const monthOptions = useMemo(() => {
    const months = [...new Set(availableMonths)].sort().reverse();
    return selectedMonth && !months.includes(selectedMonth) ? [selectedMonth, ...months] : months;
  }, [availableMonths, selectedMonth]);

  const changeReportingMonth = (next: string) => {
    const [year, month] = next.split("-");
    if (/^\d{4}$/.test(year) && /^\d{2}$/.test(month)) {
      setSelectedYear(year);
      setSelectedPeriod(month);
    }
    void onReportingMonthChange?.(next);
  };
  const refresh = () => { triggerRefresh(); void onRefresh?.(); };

  const activeAdvancedCount = selectedReportView === "executive"
    ? Number(selectedTrend !== "Last 3 Months") + Number(compareMode !== "none")
    : selectedReportView === "dashboard"
      ? Number(selectedCategory !== "All") + Number(selectedUPSGroup !== "All") + Number(compareMode !== "none")
      : Number(selectedBenchmarkReference !== "all");

  const advancedFilters = <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid={`advanced-filters-${selectedReportView}`}>
    {selectedReportView === "executive" && <>
      <label><span className={labelClass}>{copy.trend}</span><SelectShell><select value={selectedTrend} onChange={event => setSelectedTrend(event.target.value)} className={selectClass}><option>Last 3 Months</option><option>Last 6 Months</option><option>Last 12 Months</option></select></SelectShell></label>
      <label><span className={labelClass}>{copy.compare}</span><SelectShell><select value={compareMode} onChange={event => setCompareMode(event.target.value as typeof compareMode)} className={selectClass}><option value="none">{th ? "ไม่เปรียบเทียบ" : "No Comparison"}</option><option value="prev_month">{th ? "เดือนก่อนหน้า" : "Previous Month"}</option><option value="prev_year">{th ? "ปีก่อนหน้า" : "Previous Year"}</option><option value="rolling_avg">{th ? "ค่าเฉลี่ย 3 เดือน" : "3-Month Rolling Average"}</option><option value="best_worst">{th ? "ดีที่สุด / แย่ที่สุด" : "Best / Worst Month"}</option></select></SelectShell></label>
    </>}
    {selectedReportView === "dashboard" && <>
      <label><span className={labelClass}>{copy.category}</span><SelectShell><select value={selectedCategory} onChange={event => setSelectedCategory(event.target.value as typeof selectedCategory)} className={selectClass}>{engineeringCategories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></SelectShell></label>
      <label><span className={labelClass}>{copy.ups}</span><SelectShell><select value={selectedUPSGroup} onChange={event => setSelectedUPSGroup(event.target.value)} className={selectClass}>{upsGroupOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></SelectShell></label>
      <label><span className={labelClass}>{copy.compare}</span><SelectShell><select value={compareMode} onChange={event => setCompareMode(event.target.value as typeof compareMode)} className={selectClass}><option value="none">{th ? "ไม่เปรียบเทียบ" : "No Comparison"}</option><option value="prev_month">{th ? "เดือนก่อนหน้า" : "Previous Month"}</option><option value="prev_year">{th ? "ปีก่อนหน้า" : "Previous Year"}</option><option value="rolling_avg">{th ? "ค่าเฉลี่ย 3 เดือน" : "3-Month Rolling Average"}</option><option value="best_worst">{th ? "ดีที่สุด / แย่ที่สุด" : "Best / Worst Month"}</option></select></SelectShell></label>
    </>}
    {selectedReportView === "benchmark" && <>
      <label><span className={labelClass}>{copy.benchmark}</span><SelectShell><select value={selectedBenchmarkReference} onChange={event => setSelectedBenchmarkReference(event.target.value as BenchmarkReference)} className={selectClass}><option value="all">{th ? "ทุกเกณฑ์อ้างอิง" : "All References"}</option><option value="best">{th ? "เดือนที่ดีที่สุด" : "Best Month"}</option><option value="rolling">{th ? "ค่าเฉลี่ย 3 เดือน" : "3-Month Rolling Average"}</option><option value="worst">{th ? "เดือนที่แย่ที่สุด" : "Worst Month"}</option></select></SelectShell></label>
      <label><span className={labelClass}>{copy.period}</span><SelectShell><select value={selectedYear} onChange={event => setSelectedYear(event.target.value)} className={selectClass}>{[...new Set([selectedYear, ...availableYears])].sort((a,b)=>b.localeCompare(a)).map(year => <option key={year}>{year}</option>)}</select></SelectShell></label>
    </>}
  </div>;

  return <section className="relative rounded-2xl border border-slate-800 bg-slate-900/90 p-3 shadow-lg" data-testid="filter-bar-v2">
    <div className="grid gap-2.5 md:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_minmax(170px,1fr)_auto] md:items-end">
      <div className="min-w-0">
        <span className={labelClass}>{copy.site}</span>
        <div className="flex min-h-[38px] items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-3 text-xs font-semibold text-slate-200"><Building2 className="h-4 w-4 shrink-0 text-indigo-400"/><span className="truncate">{siteName}</span></div>
      </div>
      <label className="min-w-0"><span className={labelClass}>{copy.month}</span><SelectShell><select aria-label={copy.month} value={selectedMonth} onChange={event => changeReportingMonth(event.target.value)} className={selectClass}>{monthOptions.length ? monthOptions.map(value => <option key={value} value={value}>{value}</option>) : <option value={selectedMonth}>{selectedMonth || "—"}</option>}</select></SelectShell></label>
      <label className="min-w-0"><span className={labelClass}>{copy.view}</span><SelectShell><select value={selectedReportView} onChange={event => setSelectedReportView(event.target.value as ReportViewId)} className={selectClass}>{REPORT_VIEW_TABS.filter(tab => reportViews.includes(tab.id)).map(tab => <option key={tab.id} value={tab.id}>{th ? tab.labelTh : tab.labelEn}</option>)}</select></SelectShell></label>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <button type="button" onClick={() => setFiltersOpen(true)} aria-expanded={filtersOpen} className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-bold text-slate-300 hover:border-indigo-500/50 hover:text-indigo-300"><SlidersHorizontal className="h-4 w-4"/>{copy.filters}{activeAdvancedCount > 0 && <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[9px] text-indigo-300">{activeAdvancedCount}</span>}</button>
        {showUtilityActions && <button type="button" onClick={refresh} className="inline-flex min-h-[38px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-bold text-slate-300 hover:border-indigo-500/50 hover:text-indigo-300"><RefreshCw className="h-4 w-4"/>{copy.refresh}</button>}
        {showUtilityActions && onExport && <div className="flex min-h-[38px] items-center rounded-xl border border-slate-700 bg-slate-950 p-1"><span className="hidden px-2 text-[9px] font-bold uppercase text-slate-500 xl:inline">{copy.export}</span>{exportFormats.map(format => <button key={format} type="button" onClick={() => onExport(format)} className="rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase text-slate-300 hover:bg-indigo-500/15 hover:text-indigo-300">{format}</button>)}</div>}
      </div>
    </div>

    {filtersOpen && <>
      <div className="mt-3 hidden rounded-xl border border-slate-800 bg-slate-950/70 p-4 md:block"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-bold text-slate-300"><Gauge className="h-4 w-4 text-indigo-400"/>{copy.filters}</div><button type="button" onClick={() => setFiltersOpen(false)} aria-label={copy.close} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-slate-200"><X className="h-4 w-4"/></button></div>{advancedFilters}</div>
      <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={copy.filters}><button type="button" aria-label={copy.close} onClick={() => setFiltersOpen(false)} className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"/><section className="absolute bottom-0 left-0 right-0 max-h-[75vh] overflow-y-auto rounded-t-3xl border-t border-slate-700 bg-slate-900 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-base font-bold text-slate-100">{copy.filters}</h2><button type="button" onClick={() => setFiltersOpen(false)} aria-label={copy.close} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-700 text-slate-300"><X className="h-4 w-4"/></button></div>{advancedFilters}</section></div>
    </>}
  </section>;
}
