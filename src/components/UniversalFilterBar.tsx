import React, { useMemo } from "react";
import { useReport } from "../ReportContext";
import type { FacilityEntry } from "../desktop";
import { 
  Calendar, 
  Layers, 
  TrendingUp, 
  Grid, 
  SlidersHorizontal, 
  RefreshCw, 
  Download,
  Check,
  ChevronDown
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type ReportViewId = "executive" | "dashboard" | "benchmark" | "forecast";
const ALL_REPORT_VIEWS: readonly ReportViewId[] = ["executive", "dashboard", "benchmark", "forecast"];
const REPORT_VIEW_TABS: ReadonlyArray<{ id: ReportViewId; labelEn: string; labelTh: string }> = [
  { id: "executive", labelEn: "Executive View", labelTh: "1. แดชบอร์ดผู้บริหาร" },
  { id: "dashboard", labelEn: "Engineering View", labelTh: "2. วิเคราะห์วิศวกรรม" },
  { id: "benchmark", labelEn: "Benchmark View", labelTh: "3. เปรียบเทียบเกณฑ์" },
  { id: "forecast", labelEn: "Forecast View", labelTh: "4. คาดการณ์เทรนด์" }
];

interface UniversalFilterBarProps {
  onExport?: (format: "pdf" | "excel" | "csv" | "png") => void;
  lang: "th" | "en";
  facility?: FacilityEntry | null;
  /** Which of the 4 sub-view tabs to render, in order. Defaults to all 4
   *  (Desktop's existing behavior, unchanged). A caller that only supports a
   *  subset of views (e.g. a host with no Benchmark/Forecast implementation)
   *  passes just the views it actually has - never a hidden/disabled tab for
   *  a view that doesn't exist there. */
  reportViews?: readonly ReportViewId[];
}

export default function UniversalFilterBar({ onExport, lang, facility = null, reportViews = ALL_REPORT_VIEWS }: UniversalFilterBarProps) {
  const {
    selectedYear,
    selectedPeriod,
    selectedTrend,
    compareMode,
    selectedCategory,
    selectedUPSGroup,
    selectedReportView,
    
    setSelectedYear,
    setSelectedPeriod,
    setSelectedTrend,
    setCompareMode,
    setSelectedCategory,
    setSelectedUPSGroup,
    setSelectedReportView,
    
    triggerRefresh
  } = useReport();

  const dict = {
    th: {
      year: "ปี",
      period: "ระยะเวลา",
      trend: "แนวโน้ม",
      category: "หมวดหมู่",
      upsGroup: "กลุ่ม UPS",
      compare: "เปรียบเทียบ",
      export: "ส่งออก",
      refresh: "รีเฟรช",
      
      allYears: "ทุกปี",
      currentYear: "ปีปัจจุบัน",
      entireYear: "ตลอดทั้งปี",
      ytd: "สะสมตั้งแต่ต้นปี (YTD)",
      lastMonth: "เดือนล่าสุด",
      
      allCategories: "ทุกหมวดหมู่",
      allUpsGroups: "ทุกกลุ่ม UPS",
      
      // Months
      "01": "มกราคม", "02": "กุมภาพันธ์", "03": "มีนาคม", "04": "เมษายน",
      "05": "พฤษภาคม", "06": "มิถุนายน", "07": "กรกฎาคม", "08": "สิงหาคม",
      "09": "กันยายน", "10": "ตุลาคม", "11": "พฤศจิกายน", "12": "ธันวาคม",
      
      compareNone: "ไม่เปรียบเทียบ",
      comparePrevMonth: "เดือนก่อนหน้า",
      comparePrevYear: "ปีก่อนหน้า",
      compareRollingAvg: "ค่าเฉลี่ยเคลื่อนที่",
      compareBestWorst: "ดีที่สุด / แย่ที่สุด",
      
      last3: "ย้อนหลัง 3 เดือน",
      last6: "ย้อนหลัง 6 เดือน",
      last12: "ย้อนหลัง 12 เดือน",
      rollingWindow: "หน้าต่างเลื่อน (Rolling)",
    },
    en: {
      year: "Year",
      period: "Period",
      trend: "Trend",
      category: "Category",
      upsGroup: "UPS Group",
      compare: "Compare",
      export: "Export",
      refresh: "Refresh",
      
      allYears: "All Years",
      currentYear: "Current Year",
      entireYear: "Entire Year",
      ytd: "Year-To-Date (YTD)",
      lastMonth: "Last Month",
      
      allCategories: "All Categories",
      allUpsGroups: "All UPS Groups",
      
      // Months
      "01": "January", "02": "February", "03": "March", "04": "April",
      "05": "May", "06": "June", "07": "July", "08": "August",
      "09": "September", "10": "October", "11": "November", "12": "December",
      
      compareNone: "No Comparison",
      comparePrevMonth: "Previous Month",
      comparePrevYear: "Previous Year",
      compareRollingAvg: "Rolling Average",
      compareBestWorst: "Best/Worst Month",
      
      last3: "Last 3 Months",
      last6: "Last 6 Months",
      last12: "Last 12 Months",
      rollingWindow: "Rolling Window",
    }
  };

  const t = dict[lang];

  // Static options for months
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];

  // Config-driven only: group and individual-ID options come from the active
  // facility's own dashboard config (facility.profile.dashboard). No facility
  // id/name branching - a new facility needs a profile.json entry, not a
  // component change.
  const upsGroupOptions = [
    { value: "All", label: t.allUpsGroups },
    ...(facility?.profile.dashboard.upsGroups ?? []).map(g => ({ value: g.name, label: g.name })),
    ...(facility?.profile.dashboard.upsMapping ?? []).map(m => ({ value: m.upsId, label: m.upsId }))
  ];

  const categories = [
    { value: "All", label: t.allCategories },
    { value: "UPS", label: "UPS" },
    { value: "Air Conditioning", label: lang === "th" ? "ระบบปรับอากาศ" : "Air Conditioning" },
    { value: "DC", label: "DC Power" },
    { value: "Energy Cost", label: lang === "th" ? "ค่าไฟฟ้า" : "Energy Cost" },
    { value: "PUE", label: "PUE" },
    { value: "Carbon", label: lang === "th" ? "คาร์บอน (Carbon)" : "Carbon Footprint" },
  ];

  return (
    <section className="bg-slate-900/90 border border-slate-800 p-4 rounded-2xl shadow-xl flex flex-col gap-4 animate-fadeIn">
      {/* Upper Filter Bar with Dropdowns */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        
        {/* Year Select */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Calendar className="w-3 h-3 text-indigo-400" />
            {t.year}
          </label>
          <div className="relative">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full bg-slate-950 text-slate-100 font-semibold text-xs border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none transition-all"
            >
              <option value={selectedYear}>{selectedYear}</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Period Select */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Grid className="w-3 h-3 text-teal-400" />
            {t.period}
          </label>
          <div className="relative">
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="w-full bg-slate-950 text-slate-100 font-semibold text-xs border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none transition-all"
            >
              <option value="Entire Year">{t.entireYear}</option>
              <option value="YTD">{t.ytd}</option>
              <option value="Last Month">{t.lastMonth}</option>
              {months.map(m => (
                <option key={m} value={m}>{months.indexOf(m) + 1}. {t[m as keyof typeof t]}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Trend Filter */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-amber-400" />
            {t.trend}
          </label>
          <div className="relative">
            <select
              value={selectedTrend}
              onChange={(e) => setSelectedTrend(e.target.value)}
              className="w-full bg-slate-950 text-slate-100 font-semibold text-xs border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none transition-all"
            >
              <option value="Last 3 Months">{t.last3}</option>
              <option value="Last 6 Months">{t.last6}</option>
              <option value="Last 12 Months">{t.last12}</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Category Select */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3 h-3 text-purple-400" />
            {t.category}
          </label>
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as any)}
              className="w-full bg-slate-950 text-slate-100 font-semibold text-xs border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none transition-all"
            >
              {categories.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* UPS Group Filter */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <SlidersHorizontal className="w-3 h-3 text-sky-400" />
            {t.upsGroup}
          </label>
          <div className="relative">
            <select
              value={selectedUPSGroup}
              onChange={(e) => setSelectedUPSGroup(e.target.value)}
              className="w-full bg-slate-950 text-slate-100 font-semibold text-xs border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none transition-all"
            >
              {upsGroupOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Compare Mode */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <SlidersHorizontal className="w-3 h-3 text-rose-400" />
            {t.compare}
          </label>
          <div className="relative">
            <select
              value={compareMode}
              onChange={(e) => setCompareMode(e.target.value as any)}
              className="w-full bg-slate-950 text-slate-100 font-semibold text-xs border border-slate-800 hover:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none transition-all"
            >
              <option value="none">{t.compareNone}</option>
              <option value="prev_month">{t.comparePrevMonth}</option>
              <option value="prev_year">{t.comparePrevYear}</option>
              <option value="rolling_avg">{t.compareRollingAvg}</option>
              <option value="best_worst">{t.compareBestWorst}</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

      </div>

      {/* Action buttons (Export, Refresh) */}
      <div className="flex flex-wrap items-center justify-between border-t border-slate-800/80 pt-3 gap-2">
        {/* Sub-view Segmented Tabs - only the views this host actually implements */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-850">
          {REPORT_VIEW_TABS.filter(tab => reportViews.includes(tab.id)).map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedReportView(tab.id)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                selectedReportView === tab.id
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/10"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {lang === "th" ? tab.labelTh : tab.labelEn}
            </button>
          ))}
        </div>

        {/* Refresh & Exports */}
        <div className="flex items-center gap-2">
          {/* Refresh Button */}
          <button
            onClick={triggerRefresh}
            className="p-2 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer"
            title="Refresh Analysis State"
          >
            <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
            <span>{t.refresh}</span>
          </button>

          {/* Export Dropdown Options */}
          {onExport && (
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 font-bold px-2 uppercase tracking-wide">{t.export}:</span>
              {["pdf", "excel", "csv", "png"].map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => onExport(fmt as any)}
                  className="px-2.5 py-1 bg-slate-900 hover:bg-indigo-600/20 hover:text-indigo-300 text-slate-300 hover:border-indigo-500/30 text-[10px] font-bold rounded-lg uppercase tracking-wider transition-all border border-transparent cursor-pointer"
                >
                  {fmt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
