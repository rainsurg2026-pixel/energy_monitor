import React, { useState, useMemo } from "react";
import { MonthlyLog } from "../types";
import { formatMonthYear, formatTimestampValue } from "../utils";
import { calculateEnergyCostForMonth, getAirFields, getAirValue, normalizedMonth } from "../utils/energyCost";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { formatRatioPercent } from "../utils/rackCapacity";
import type { UpsGroupHistoryReport } from "../reports/reportTypes";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import RackCapacityHistoryPanel from "./rack/RackCapacityHistoryPanel";
import { RackCapacityProvider } from "./rack/RackCapacityContext";
import { filterLogsForDisplay } from "../utils/displayPeriod";
import { recentMonthsThroughSelected } from "../utils/historyWindow";
import {
  Zap,
  Thermometer,
  Database,
  Coins,
  Search,
  FileSpreadsheet,
  TableProperties,
  Calendar,
  Layers,
  ArrowUpDown,
  CheckCircle,
  HelpCircle,
  Clock,
  ArrowRight,
  Boxes
} from "lucide-react";

interface HistoricalExplorerProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
  isGoogleConnected?: boolean;
  googleUserEmail?: string | null;
  onEditMonth?: (monthStr: string) => void;
  /** Persisted "2. UPS Group History" worksheet - the UPS tab reads directly
   *  from this instead of rebuilding summaries at runtime. */
  upsGroupHistory?: UpsGroupHistoryReport | null;
  activeFacilityId?: string | null;
  /** Persisted Rack Capacity History (facility total + per-zone snapshots)
   *  and Rack Unit Capacity rows, for the Rack Capacity tab - real recorded
   *  snapshots only, never the current live Table7 masquerading as history. */
  rackCapacityHistory?: RackCapacityHistoryRow[];
  rackUnitCapacity?: RackUnitCapacityRow[];
  displayPeriod?: string;
  selectedMonth: string;
}

type ExplorerTab = "ups" | "air" | "dc" | "energy" | "rack";
type SortOrder = "newest" | "oldest";
type HistoryRange = "all" | "3" | "6" | "12";

// Helper to calculate days in month
function getDaysInMonth(monthStr: string): number {
  if (!monthStr) return 30;
  const [yearStr, monthStrPart] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStrPart, 10);
  return new Date(year, month, 0).getDate();
}

export default function HistoricalExplorer({ logs, lang, isGoogleConnected = false, googleUserEmail = null, onEditMonth, upsGroupHistory = null, activeFacilityId = null, rackCapacityHistory = [], rackUnitCapacity = [], displayPeriod = "2026", selectedMonth }: HistoricalExplorerProps) {
  const displayLogs = useMemo(() => filterLogsForDisplay(logs, displayPeriod), [logs, displayPeriod]);
  const [activeTab, setActiveTab] = useState<ExplorerTab>("ups");
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("6");

  const dict = {
    th: {
      title: "สืบค้นและวิเคราะห์ประวัติอย่างละเอียด (Historical Data Explorer)",
      subtitle: "สืบค้นข้อมูลเชิงลึก ตรวจสอบความถูกต้อง พร้อมตัวกรองระบบ เรียงลำดับ และสถานะบันทึกย้อนหลัง",
      tabUps: "ประวัติเครื่อง UPS",
      tabAir: "ประวัติระบบปรับอากาศ",
      tabDc: "ประวัติแผงจ่ายไฟ DC",
      tabRack: "ประวัติความจุแร็ค",
      tabEnergy: "ประวัติค่าไฟฟ้า & ภาพรวม",
      searchPlaceholder: "ค้นหาด้วยชื่อเดือน เช่น Jan-26, 2026...",
      noResults: "ไม่พบข้อมูลประวัติที่ตรงกับคำค้นหาของคุณ",
      noResultsDesc: "กรุณาลองเปลี่ยนคำค้นหา หรือกรอกข้อมูลของเดือนใหม่",
      month: "เดือน",
      upsId: "เครื่อง UPS",
      upsGroup: "กลุ่ม UPS",
      voltage: "แรงดัน (V)",
      current: "กระแส (A)",
      loadKw: "โหลด (kW)",
      loadKva: "โหลด (kVA)",
      capacity: "พิกัด UPS (kVA)",
      loadPercent: "โหลด (%)",
      availablePercent: "ว่าง (%)",
      generatedTimestamp: "เวลาที่ประมวลผล",
      timestamp: "เวลาที่บันทึกล่าสุด",
      panelId: "ชื่อแผงจ่ายไฟ DC",
      dcPower: "กำลังไฟ DC (W)",
      acPower: "กำลังไฟ AC (W)",
      monthlyEnergy: "พลังงานรวม (kWh)",
      buildingEnergy: "พลังงานทั้งอาคาร (kWh)",
      buildingCost: "ค่าไฟฟ้าทั้งอาคาร (บาท)",
      floorEnergy: "พลังงานชั้น 4 (kWh)",
      floorCost: "ค่าไฟฟ้าชั้น 4 (บาท)",

      // Statuses
      editStatus: "สถานะแก้ไข",
      syncStatus: "สถานะซิงค์",
      draft: "ร่าง (ยังไม่ครบ)",
      complete: "เสร็จสมบูรณ์",
      synced: "ซิงค์แล้ว",
      localOnly: "ออฟไลน์ (Local)",
      pendingUpload: "รอซิงค์บิลด์",
      original: "ต้นฉบับ",
      modified: "แก้ไขแล้ว",

      // Filters
      allYears: "ทุกปี",
      allMonths: "ทุกเดือน",
      sortNewest: "ใหม่ล่าสุดก่อน",
      sortOldest: "เก่าที่สุดก่อน",
      quickJump: "กระโดดด่วนไปยังเดือน",
      historyRange: "ช่วงเวลา",
      allHistory: "ทั้งหมด",
      last3Months: "ย้อนหลัง 3 เดือน",
      last6Months: "ย้อนหลัง 6 เดือน",
      last12Months: "ย้อนหลัง 12 เดือน"
    },
    en: {
      title: "Historical Operations Explorer",
      subtitle: "Query, search, sort, and audit raw facility logs with high-fidelity status badges across subsystems.",
      tabUps: "UPS Loads History",
      tabAir: "Air Conditioning History",
      tabRack: "Rack Capacity History",
      tabDc: "DC Power Panels History",
      tabEnergy: "Energy & Cost History",
      searchPlaceholder: "Search by month name, e.g. Jan-26, 2026...",
      noResults: "No history logs match your search",
      noResultsDesc: "Try adjusting your filters or record logs for a new month first.",
      month: "Month",
      upsId: "UPS ID",
      upsGroup: "UPS Group",
      voltage: "Voltage (V)",
      current: "Current (A)",
      loadKw: "Load (kW)",
      loadKva: "Load (kVA)",
      capacity: "UPS Capacity (kVA)",
      loadPercent: "Load (%)",
      availablePercent: "Available (%)",
      generatedTimestamp: "Generated Timestamp",
      timestamp: "Last Timestamp",
      panelId: "DC Panel ID",
      dcPower: "DC Power (W)",
      acPower: "AC Power (W)",
      monthlyEnergy: "Monthly Energy (kWh)",
      buildingEnergy: "Building Energy (kWh)",
      buildingCost: "Building Cost (THB)",
      floorEnergy: "4th Floor Energy (kWh)",
      floorCost: "4th Floor Cost (THB)",

      // Statuses
      editStatus: "Edit Status",
      syncStatus: "Sync Status",
      draft: "Draft (Incomplete)",
      complete: "Complete",
      synced: "Synced",
      localOnly: "Local Only",
      pendingUpload: "Pending Upload",
      original: "Original",
      modified: "Modified",

      // Filters
      allYears: "All Years",
      allMonths: "All Months",
      sortNewest: "Newest First",
      sortOldest: "Oldest First",
      quickJump: "Quick Jump to Month",
      historyRange: "History Range",
      allHistory: "All Months",
      last3Months: "Last 3 Months",
      last6Months: "Last 6 Months",
      last12Months: "Last 12 Months"
    }
  };

  const t = dict[lang];

  // Dynamically extract years for filter
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    displayLogs.forEach(l => {
      const y = l.month.split("-")[0];
      if (y) years.add(y);
    });
    return Array.from(years).sort();
  }, [displayLogs]);

  // Months array for filtering
  const monthsArray = [
    { value: "01", label: lang === "th" ? "ม.ค." : "Jan" },
    { value: "02", label: lang === "th" ? "ก.พ." : "Feb" },
    { value: "03", label: lang === "th" ? "มี.ค." : "Mar" },
    { value: "04", label: lang === "th" ? "เม.ย." : "Apr" },
    { value: "05", label: lang === "th" ? "พ.ค." : "May" },
    { value: "06", label: lang === "th" ? "มิ.ย." : "Jun" },
    { value: "07", label: lang === "th" ? "ก.ค." : "Jul" },
    { value: "08", label: lang === "th" ? "ส.ค." : "Aug" },
    { value: "09", label: lang === "th" ? "ก.ย." : "Sep" },
    { value: "10", label: lang === "th" ? "ต.ค." : "Oct" },
    { value: "11", label: lang === "th" ? "พ.ย." : "Nov" },
    { value: "12", label: lang === "th" ? "ธ.ค." : "Dec" }
  ];

  // The range selector is based on the latest reporting months present in the
  // workbook, rather than the current calendar date or array position.
  const latestReportingMonths = useMemo<string[]>(() => {
    const months: string[] = displayLogs
      .map(log => normalizedMonth(log.month))
      .filter((month): month is string => month !== null);
    return recentMonthsThroughSelected(months, selectedMonth, months.length);
  }, [displayLogs, selectedMonth]);

  // Quick Jump: only real, chronological months that actually exist in this
  // (already facility-scoped, via the `logs` prop) workbook, restricted to
  // the active reporting year - the year of the most recent real month, not
  // the calendar's current year, since offline data can lag behind today.
  // Recomputes automatically on facility switch because `logs` itself does.
  const quickJumpEntries = useMemo(() => {
    const monthToLog = new Map<string, MonthlyLog>();
    for (const log of displayLogs) {
      const normalized = normalizedMonth(log.month);
      if (normalized && !monthToLog.has(normalized)) monthToLog.set(normalized, log);
    }
    const activeReportingYear = selectedMonth.slice(0, 4) || latestReportingMonths[0]?.slice(0, 4);
    if (!activeReportingYear) return [];
    return latestReportingMonths
      .filter(month => month.startsWith(activeReportingYear))
      .map(month => monthToLog.get(month))
      .filter((log): log is MonthlyLog => log !== undefined);
  }, [displayLogs, latestReportingMonths, selectedMonth]);

  // Core processing & filtering
  const filteredAndSortedLogs = useMemo(() => {
    let result = [...displayLogs];

    if (historyRange !== "all") {
      const limit = Number(historyRange);
      const selectedMonths = new Set(latestReportingMonths.slice(0, limit));
      result = result.filter(log => {
        const month = normalizedMonth(log.month);
        return month !== null && selectedMonths.has(month);
      });
    }

    // Filter by year
    if (yearFilter !== "All") {
      result = result.filter(log => log.month.startsWith(yearFilter));
    }

    // Filter by month
    if (monthFilter !== "All") {
      result = result.filter(log => log.month.endsWith(`-${monthFilter}`));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      result = result.filter(log => {
        const displayMonth = formatMonthYear(log.month).toLowerCase();
        const rawMonth = log.month.toLowerCase();
        return displayMonth.includes(searchQuery.toLowerCase()) || rawMonth.includes(searchQuery.toLowerCase());
      });
    }

    // Sort order
    result.sort((a, b) => {
      if (sortOrder === "newest") {
        return b.month.localeCompare(a.month);
      } else {
        return a.month.localeCompare(b.month);
      }
    });

    return result;
  }, [displayLogs, historyRange, latestReportingMonths, yearFilter, monthFilter, searchQuery, sortOrder]);

  // Row status resolvers
  const resolveStatuses = (log: MonthlyLog): {
    editStatus: "draft" | "complete";
    syncStatus: "synced" | "pending" | "local";
    modifiedStatus: "original" | "modified";
  } => {
    // 1. Edit Status: Draft if any core values are missing
    const hasMissingUps = log.ups.some(u => u.voltage === null || u.current === null || u.loadKw === null);
    const hasMissingAir = getAirFields(log).some(field => getAirValue(log, field) === null);
    const hasMissingDc = log.dc.some(p => p.voltage === null || p.current === null);
    const isDraft = hasMissingUps || hasMissingAir || hasMissingDc;

    // 2. Sync Status
    const isSynced = isGoogleConnected && (log.lastSavedUps || log.lastSavedAir || log.lastSavedDc);
    const isPendingUpload = isGoogleConnected && !isSynced;

    return {
      editStatus: isDraft ? ("draft" as const) : ("complete" as const),
      syncStatus: isSynced ? ("synced" as const) : isPendingUpload ? ("pending" as const) : ("local" as const),
      modifiedStatus: (log.lastSavedUps || log.lastSavedAir) ? ("original" as const) : ("modified" as const)
    };
  };

  // Render status badges
  const renderEditBadge = (status: "draft" | "complete") => {
    if (status === "draft") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/15">
          <Clock className="w-3 h-3" />
          <span>{t.draft}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
        <CheckCircle className="w-3 h-3" />
        <span>{t.complete}</span>
      </span>
    );
  };

  const renderSyncBadge = (status: "synced" | "pending" | "local") => {
    if (status === "synced") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/15">
          <span>{t.synced}</span>
        </span>
      );
    }
    if (status === "pending") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/15 animate-pulse">
          <span>{t.pendingUpload}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400 border border-slate-750">
        <span>{t.localOnly}</span>
      </span>
    );
  };

  // Render functions for table tabs
  // UPS Group History: read directly from the workbook's persisted
  // "2. UPS Group History" sheet (src/reports/upsGroupHistoryReader.ts) -
  // the exact same aggregation (src/utils/upsGroupAggregation.ts) that
  // wrote it, so this table and Dashboard Summary can never disagree.
  const renderUpsHistory = () => {
    const visibleMonths = new Set(filteredAndSortedLogs.map(log => log.month));
    const statusesByMonth = new Map<string, ReturnType<typeof resolveStatuses>>(
      displayLogs.map(log => [log.month, resolveStatuses(log)])
    );
    const historyRows = (upsGroupHistory?.rows ?? [])
      .filter(row => visibleMonths.has(row.month))
      .filter(row => !activeFacilityId || row.facility.toLowerCase() === activeFacilityId.toLowerCase())
      .sort((a, b) => (sortOrder === "newest" ? b.month.localeCompare(a.month) : a.month.localeCompare(b.month)) || a.group.localeCompare(b.group));

    if (!upsGroupHistory || upsGroupHistory.rows.length === 0) {
      return (
        <div className="py-10 text-center text-slate-500 italic text-xs">
          {lang === "th"
            ? "ไม่มีประวัติกลุ่ม UPS สำหรับไซต์และช่วงเวลานี้"
            : "No UPS Group History is available for this facility in the selected display period."}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-sans">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
              <th className="py-3.5 px-4">{t.month}</th>
              <th className="py-3.5 px-4">{t.upsGroup}</th>
              <th className="py-3.5 px-4 text-right">{t.loadKw}</th>
              <th className="py-3.5 px-4 text-right">{t.loadKva}</th>
              <th className="py-3.5 px-4 text-right">{t.capacity}</th>
              <th className="py-3.5 px-4 text-right">{t.loadPercent}</th>
              <th className="py-3.5 px-4 text-right">{t.availablePercent}</th>
              <th className="py-3.5 px-4 text-right">{t.monthlyEnergy}</th>
              <th className="py-3.5 px-4 text-center">{lang === "th" ? "สถานะ" : "Status"}</th>
              <th className="py-3.5 px-4 text-right">{t.generatedTimestamp}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {historyRows.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-500 italic">{t.noResults}</td>
              </tr>
            ) : (
              historyRows.map((r, idx) => {
                const statuses = statusesByMonth.get(r.month);
                return (
                  <tr key={idx} className="hover:bg-slate-900/35 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">{formatMonthYear(r.month)}</td>
                    <td className="py-3.5 px-4 text-indigo-400 font-semibold">{r.group}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300">{formatNumber2(r.totalLoadKw)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-300">{formatNumber2(r.totalLoadKva)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-400">{formatNumber2(r.capacity)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-indigo-400 font-semibold">{r.loadPercent === null ? "—" : `${formatNumber2(r.loadPercent)}%`}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-emerald-400">{r.availablePercent === null ? "—" : `${formatNumber2(r.availablePercent)}%`}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-indigo-300">{formatNumber2(r.monthlyEnergyKwh)}</td>
                    <td className="py-3.5 px-4 text-center space-x-1.5 whitespace-nowrap">
                      {statuses && renderEditBadge(statuses.editStatus)}
                      {statuses && renderSyncBadge(statuses.syncStatus)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-500 text-[10px]">{r.generatedAt ? r.generatedAt.replace("T", " ").slice(0, 19) : "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderAirHistory = () => {
    const airFields: string[] = Array.from(new Set<string>(displayLogs.flatMap(log => getAirFields(log))));
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-sans">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
              <th className="py-3.5 px-4">{t.month}</th>
              {airFields.map(field => <th key={field} className="py-3.5 px-4 text-right">{field.toUpperCase()} (GWh)</th>)}
              <th className="py-3.5 px-4 text-right">{t.monthlyEnergy}</th>
              <th className="py-3.5 px-4 text-center">{lang === "th" ? "สถานะ" : "Status"}</th>
              <th className="py-3.5 px-4 text-right">{t.timestamp}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {filteredAndSortedLogs.length === 0 ? (
              <tr>
                <td colSpan={airFields.length + 4} className="py-8 text-center text-slate-500 italic">{t.noResults}</td>
              </tr>
            ) : (
              filteredAndSortedLogs.map((log, idx) => {
                const airEnergyKwh = calculateEnergyCostForMonth(logs, log.month).airEnergyKwh;
                const statuses = resolveStatuses(log);

                return (
                  <tr key={idx} className="hover:bg-slate-900/35 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">{formatMonthYear(log.month)}</td>
                    {airFields.map(field => {
                      const value = getAirValue(log, field);
                      return <td key={field} className="py-3.5 px-4 text-right font-mono">{formatNumber2(value)}</td>;
                    })}
                    <td className="py-3.5 px-4 text-right font-mono text-teal-400 font-bold">
                      {airEnergyKwh === null ? "—" : `${formatNumber2(airEnergyKwh)} kWh`}
                    </td>
                    <td className="py-3.5 px-4 text-center space-x-1.5 whitespace-nowrap">
                      {renderEditBadge(statuses.editStatus)}
                      {renderSyncBadge(statuses.syncStatus)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-500 text-[10px]">{formatTimestampValue(log.lastSavedAir) || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderDcHistory = () => {
    const rows: any[] = [];
    filteredAndSortedLogs.forEach(log => {
      const monthLabel = formatMonthYear(log.month);
      const days = getDaysInMonth(log.month);
      const statuses = resolveStatuses(log);

      log.dc.forEach(p => {
        const v = p.voltage === null ? 0 : p.voltage;
        const a = p.current === null ? 0 : p.current;
        const dcPowerW = v * a;
        const acPowerW = (dcPowerW / 200) * 220;
        const energyKwh = (acPowerW * 24 * days) / 1000;

        rows.push({
          monthLabel,
          panelId: p.panelId,
          voltage: p.voltage,
          current: p.current,
          dcPowerW,
          acPowerW,
          energyKwh,
          timestamp: formatTimestampValue(log.lastSavedDc),
          statuses
        });
      });
    });

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-sans">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
              <th className="py-3.5 px-4">{t.month}</th>
              <th className="py-3.5 px-4">{t.panelId}</th>
              <th className="py-3.5 px-4 text-right">{t.voltage}</th>
              <th className="py-3.5 px-4 text-right">{t.current}</th>
              <th className="py-3.5 px-4 text-right">{t.dcPower}</th>
              <th className="py-3.5 px-4 text-right">{t.acPower}</th>
              <th className="py-3.5 px-4 text-right">{t.monthlyEnergy}</th>
              <th className="py-3.5 px-4 text-center">{lang === "th" ? "สถานะ" : "Status"}</th>
              <th className="py-3.5 px-4 text-right">{t.timestamp}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-slate-500 italic">{t.noResults}</td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={idx} className="hover:bg-slate-900/35 transition-colors">
                  <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">{r.monthLabel}</td>
                  <td className="py-3.5 px-4 text-amber-400 font-semibold">{r.panelId}</td>
                  <td className="py-3.5 px-4 text-right font-mono text-orange-200">{r.voltage !== null ? formatNumber2(r.voltage) : "—"}</td>
                  <td className="py-3.5 px-4 text-right font-mono text-orange-200">{r.current !== null ? formatNumber2(r.current) : "—"}</td>
                  <td className="py-3.5 px-4 text-right font-mono">{r.dcPowerW > 0 ? `${formatNumber2(r.dcPowerW)} W` : "—"}</td>
                  <td className="py-3.5 px-4 text-right font-mono">{r.acPowerW > 0 ? `${formatNumber2(r.acPowerW)} W` : "—"}</td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-300 font-bold">{r.energyKwh > 0 ? `${formatNumber2(r.energyKwh)} kWh` : "—"}</td>
                  <td className="py-3.5 px-4 text-center space-x-1.5 whitespace-nowrap">
                    {renderEditBadge(r.statuses.editStatus)}
                    {renderSyncBadge(r.statuses.syncStatus)}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-500 text-[10px]">{r.timestamp || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderEnergyHistory = () => {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-sans">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
              <th className="py-3.5 px-4">{t.month}</th>
              <th className="py-3.5 px-4 text-right">{t.buildingEnergy}</th>
              <th className="py-3.5 px-4 text-right">{t.buildingCost}</th>
              <th className="py-3.5 px-4 text-right">{t.floorEnergy}</th>
              <th className="py-3.5 px-4 text-right">{t.floorCost}</th>
              <th className="py-3.5 px-4 text-right">{lang === "th" ? "อัตรา (บาท/kWh)" : "Rate (฿/kWh)"}</th>
              <th className="py-3.5 px-4 text-right">{lang === "th" ? "สัดส่วน (%)" : "Share (%)"}</th>
              <th className="py-3.5 px-4 text-center">{lang === "th" ? "สถานะ" : "Status"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {filteredAndSortedLogs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500 italic">{t.noResults}</td>
              </tr>
            ) : (
              filteredAndSortedLogs.map((log, idx) => {
                const energyCost = calculateEnergyCostForMonth(logs, log.month);
                const statuses = resolveStatuses(log);

                return (
                  <tr key={idx} className="hover:bg-slate-900/35 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">{formatMonthYear(log.month)}</td>
                    <td className="py-3.5 px-4 text-right font-mono">{formatNumber2(energyCost.buildingEnergyKwh)}</td>
                    <td className="py-3.5 px-4 text-right font-mono">{energyCost.buildingElectricityCostThb === null ? "—" : `฿${formatNumber2(energyCost.buildingElectricityCostThb)}`}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-indigo-400 font-semibold">{formatNumber2(energyCost.floorEnergyKwh)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-semibold">{energyCost.floorElectricityCostThb === null ? "—" : `฿${formatNumber2(energyCost.floorElectricityCostThb)}`}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-amber-300 font-medium">{formatNumber2(energyCost.averageElectricityRateThbPerKwh)}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-teal-400 font-bold">{energyCost.energySharePercent === null ? "—" : `${formatNumber2(energyCost.energySharePercent)}%`}</td>
                    <td className="py-3.5 px-4 text-center space-x-1.5 whitespace-nowrap">
                      {renderEditBadge(statuses.editStatus)}
                      {renderSyncBadge(statuses.syncStatus)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
  };

  // Rack Capacity History: real persisted monthly snapshots (Rack Capacity
  // History + Rack Unit Capacity worksheets), never the current live Table7
  // recomputed and relabeled as "history".
  const renderRackHistory = () => {
    const sortedUnitRows = [...rackUnitCapacity].sort((a, b) => a.month.localeCompare(b.month));
    return (
      <div className="p-4 space-y-6">
        <RackCapacityProvider lang={lang} rackCapacity={null} rackUnitCapacity={rackUnitCapacity} rackCapacityHistory={rackCapacityHistory}>
          <RackCapacityHistoryPanel />
        </RackCapacityProvider>
        <div className="rounded-2xl border border-slate-850 bg-slate-900 p-5">
          <div className="flex items-center gap-2 text-slate-200 mb-3">
            <Boxes className="w-4 h-4" />
            <h4 className="text-base">{lang === "th" ? "ประวัติความจุหน่วยแร็ค (U)" : "Rack Unit Capacity History"}</h4>
          </div>
          {sortedUnitRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {lang === "th" ? "ยังไม่มีข้อมูลความจุหน่วย U สำหรับไซต์นี้" : "No Rack Unit Capacity history is available for this facility."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-sans">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
                    <th className="py-3 px-4">{t.month}</th>
                    <th className="py-3 px-4 text-right">{lang === "th" ? "ทั้งหมด (U)" : "Total (U)"}</th>
                    <th className="py-3 px-4 text-right">{lang === "th" ? "ใช้งาน (U)" : "Used (U)"}</th>
                    <th className="py-3 px-4 text-right">{lang === "th" ? "คงเหลือ (U)" : "Available (U)"}</th>
                    <th className="py-3 px-4 text-right">{lang === "th" ? "พร้อมใช้งาน (%)" : "Availability (%)"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {sortedUnitRows.map(row => (
                    <tr key={row.month} className="hover:bg-slate-900/35 transition-colors">
                      <td className="py-2.5 px-4 font-mono font-semibold text-slate-200">{formatMonthYear(row.month)}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{row.totalU}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{row.usedU}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{row.availableU}</td>
                      <td className="py-2.5 px-4 text-right font-mono">{formatRatioPercent(row.availabilityPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">

      {/* Search and Advanced Filters */}
      <div className="flex flex-col gap-4 pb-5 border-b border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="font-display font-bold text-sm text-slate-100 uppercase tracking-wider flex items-center gap-2">
              <TableProperties className="w-5 h-5 text-indigo-400" />
              <span>{t.title}</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">{t.subtitle}</p>
          </div>

          {/* Quick Search */}
          <div className="relative w-full md:w-64 shrink-0">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 text-slate-100 border border-slate-850 hover:border-slate-750 focus:border-indigo-500 rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none transition-all"
              placeholder={t.searchPlaceholder}
            />
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          </div>
        </div>

        {/* Dropdown filters block */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-850">

          {/* Year select */}
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{lang === "th" ? "กรองตามปี" : "Year Filter"}</label>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="w-full bg-slate-900 text-slate-100 text-xs rounded-lg border border-slate-800 px-2 py-1.5 cursor-pointer focus:outline-none"
            >
              <option value="All">{t.allYears}</option>
              {availableYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Month select */}
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{lang === "th" ? "กรองตามเดือน" : "Month Filter"}</label>
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="w-full bg-slate-900 text-slate-100 text-xs rounded-lg border border-slate-800 px-2 py-1.5 cursor-pointer focus:outline-none"
            >
              <option value="All">{t.allMonths}</option>
              {monthsArray.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Sort order */}
          <div className="space-y-1">
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{lang === "th" ? "เรียงตามลำดับเวลา" : "Sorting Chronological"}</label>
            <button
              onClick={() => setSortOrder(sortOrder === "newest" ? "oldest" : "newest")}
              className="w-full bg-slate-900 hover:bg-slate-850 text-slate-100 text-xs rounded-lg border border-slate-800 px-3 py-1.5 cursor-pointer flex items-center justify-between transition-colors"
            >
              <span>{sortOrder === "newest" ? t.sortNewest : t.sortOldest}</span>
              <ArrowUpDown className="w-3.5 h-3.5 text-indigo-400" />
            </button>
          </div>

          {/* Stats quick count */}
          <div className="flex flex-col justify-center text-right pr-2">
            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">{lang === "th" ? "รายการที่กรองแล้ว" : "Filtered Records"}</span>
            <strong className="text-base font-mono text-indigo-400">{filteredAndSortedLogs.length} {lang === "th" ? "เดือน" : "months"}</strong>
          </div>

        </div>

        {/* Reporting-month range selector */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-slate-950 p-3 rounded-xl border border-slate-850">
          <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider shrink-0">{t.historyRange}</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 w-full">
            {([
              { value: "all", label: t.allHistory },
              { value: "3", label: t.last3Months },
              { value: "6", label: t.last6Months },
              { value: "12", label: t.last12Months }
            ] as const).map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={historyRange === option.value}
                onClick={() => setHistoryRange(option.value)}
                className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                  historyRange === option.value
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-100 hover:border-indigo-500"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Jump buttons */}
      <div className="space-y-2">
        <h4 className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1.5">
          <Layers className="w-3 h-3 text-slate-400" />
          <span>{t.quickJump}</span>
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {quickJumpEntries.map((log) => (
            <button
              key={log.month}
              onClick={() => onEditMonth?.(log.month)}
              className="px-2.5 py-1 bg-slate-950 hover:bg-indigo-600 border border-slate-850 hover:border-indigo-500 hover:text-white text-[10px] font-bold rounded-lg flex items-center gap-1 transition-all cursor-pointer text-slate-400"
            >
              <span>{formatMonthYear(log.month)}</span>
              <ArrowRight className="w-3 h-3 text-indigo-400 hover:text-white" />
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-slate-850">
        {(
          [
            { id: "ups", label: t.tabUps, icon: Zap, color: "text-indigo-400" },
            { id: "air", label: t.tabAir, icon: Thermometer, color: "text-teal-400" },
            { id: "dc", label: t.tabDc, icon: Database, color: "text-amber-400" },
            { id: "energy", label: t.tabEnergy, icon: Coins, color: "text-emerald-400" },
            { id: "rack", label: t.tabRack, icon: Boxes, color: "text-purple-400" }
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-2 text-xs font-bold rounded-lg flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === tab.id
                ? "bg-indigo-600 text-white shadow shadow-indigo-600/10"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <tab.icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? "text-white" : tab.color}`} />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Table output rendering */}
      <div className="bg-slate-950/40 rounded-2xl border border-slate-850/60 overflow-hidden shadow-inner">
        {activeTab === "ups" && renderUpsHistory()}
        {activeTab === "air" && renderAirHistory()}
        {activeTab === "dc" && renderDcHistory()}
        {activeTab === "energy" && renderEnergyHistory()}
        {activeTab === "rack" && renderRackHistory()}
      </div>

    </div>
  );
}
