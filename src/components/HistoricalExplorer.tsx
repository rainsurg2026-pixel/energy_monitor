import React, { useState, useMemo } from "react";
import { MonthlyLog } from "../types";
import { formatMonthYear } from "../utils";
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
  ArrowRight
} from "lucide-react";

interface HistoricalExplorerProps {
  logs: MonthlyLog[];
  lang: "th" | "en";
  isGoogleConnected?: boolean;
  googleUserEmail?: string | null;
  onEditMonth?: (monthStr: string) => void;
}

type ExplorerTab = "ups" | "air" | "dc" | "energy";
type SortOrder = "newest" | "oldest";

// Helper to calculate days in month
function getDaysInMonth(monthStr: string): number {
  if (!monthStr) return 30;
  const [yearStr, monthStrPart] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStrPart, 10);
  return new Date(year, month, 0).getDate();
}

export default function HistoricalExplorer({ logs, lang, isGoogleConnected = false, googleUserEmail = null, onEditMonth }: HistoricalExplorerProps) {
  const [activeTab, setActiveTab] = useState<ExplorerTab>("ups");
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const dict = {
    th: {
      title: "สืบค้นและวิเคราะห์ประวัติอย่างละเอียด (Historical Data Explorer)",
      subtitle: "สืบค้นข้อมูลเชิงลึก ตรวจสอบความถูกต้อง พร้อมตัวกรองระบบ เรียงลำดับ และสถานะบันทึกย้อนหลัง",
      tabUps: "ประวัติเครื่อง UPS",
      tabAir: "ประวัติระบบปรับอากาศ",
      tabDc: "ประวัติแผงจ่ายไฟ DC",
      tabEnergy: "ประวัติค่าไฟฟ้า & ภาพรวม",
      searchPlaceholder: "ค้นหาด้วยชื่อเดือน เช่น Jan-26, 2026...",
      noResults: "ไม่พบข้อมูลประวัติที่ตรงกับคำค้นหาของคุณ",
      noResultsDesc: "กรุณาลองเปลี่ยนคำค้นหา หรือกรอกข้อมูลของเดือนใหม่",
      month: "เดือน",
      upsId: "เครื่อง UPS",
      voltage: "แรงดัน (V)",
      current: "กระแส (A)",
      loadKw: "โหลด (kW)",
      loadKva: "โหลด (kVA)",
      timestamp: "เวลาที่บันทึกล่าสุด",
      panelId: "ชื่อแผงจ่ายไฟ DC",
      dcPower: "กำลังไฟ DC (W)",
      acPower: "กำลังไฟ AC (W)",
      monthlyEnergy: "พลังงานรวม (kWh)",
      
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
      quickJump: "กระโดดด่วนไปยังเดือน"
    },
    en: {
      title: "Historical Operations Explorer",
      subtitle: "Query, search, sort, and audit raw facility logs with high-fidelity status badges across subsystems.",
      tabUps: "UPS Loads History",
      tabAir: "Air Conditioning History",
      tabDc: "DC Power Panels History",
      tabEnergy: "Energy & Cost History",
      searchPlaceholder: "Search by month name, e.g. Jan-26, 2026...",
      noResults: "No history logs match your search",
      noResultsDesc: "Try adjusting your filters or record logs for a new month first.",
      month: "Month",
      upsId: "UPS ID",
      voltage: "Voltage (V)",
      current: "Current (A)",
      loadKw: "Load (kW)",
      loadKva: "Load (kVA)",
      timestamp: "Last Timestamp",
      panelId: "DC Panel ID",
      dcPower: "DC Power (W)",
      acPower: "AC Power (W)",
      monthlyEnergy: "Monthly Energy (kWh)",
      
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
      quickJump: "Quick Jump to Month"
    }
  };

  const t = dict[lang];

  // Dynamically extract years for filter
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    logs.forEach(l => {
      const y = l.month.split("-")[0];
      if (y) years.add(y);
    });
    return Array.from(years).sort();
  }, [logs]);

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

  // Core processing & filtering
  const filteredAndSortedLogs = useMemo(() => {
    let result = [...logs];

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
  }, [logs, yearFilter, monthFilter, searchQuery, sortOrder]);

  // Row status resolvers
  const resolveStatuses = (log: MonthlyLog): {
    editStatus: "draft" | "complete";
    syncStatus: "synced" | "pending" | "local";
    modifiedStatus: "original" | "modified";
  } => {
    // 1. Edit Status: Draft if any core values are missing
    const hasMissingUps = log.ups.some(u => u.voltage === null || u.current === null || u.loadKw === null);
    const hasMissingAir = log.air.eb41a === null || log.air.eb41b === null;
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
  const renderUpsHistory = () => {
    const rows: any[] = [];
    filteredAndSortedLogs.forEach(log => {
      const monthLabel = formatMonthYear(log.month);
      const statuses = resolveStatuses(log);
      log.ups.forEach(u => {
        rows.push({
          monthStr: log.month,
          monthLabel,
          upsId: u.upsId,
          voltage: u.voltage,
          current: u.current,
          loadKw: u.loadKw,
          loadKva: u.loadKva,
          timestamp: log.lastSavedUps,
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
              <th className="py-3.5 px-4">{t.upsId}</th>
              <th className="py-3.5 px-4 text-right">{t.voltage}</th>
              <th className="py-3.5 px-4 text-right">{t.current}</th>
              <th className="py-3.5 px-4 text-right">{t.loadKw}</th>
              <th className="py-3.5 px-4 text-right">{t.loadKva}</th>
              <th className="py-3.5 px-4 text-center">Status</th>
              <th className="py-3.5 px-4 text-right">{t.timestamp}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500 italic">{t.noResults}</td>
              </tr>
            ) : (
              rows.map((r, idx) => (
                <tr key={idx} className="hover:bg-slate-900/35 transition-colors">
                  <td className="py-2.5 px-4 font-mono font-semibold text-slate-200">{r.monthLabel}</td>
                  <td className="py-2.5 px-4 text-indigo-400 font-semibold">{r.upsId}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-orange-200">{r.voltage !== null ? r.voltage : "—"}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-orange-200">{r.current !== null ? r.current : "—"}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-300">{r.loadKw !== null ? r.loadKw : "—"}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-300">{r.loadKva !== null ? r.loadKva : "—"}</td>
                  <td className="py-2.5 px-4 text-center space-x-1.5 whitespace-nowrap">
                    {renderEditBadge(r.statuses.editStatus)}
                    {renderSyncBadge(r.statuses.syncStatus)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-500 text-[10px]">{r.timestamp || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderAirHistory = () => {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-sans">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
              <th className="py-3.5 px-4">{t.month}</th>
              <th className="py-3.5 px-4 text-right">EB41A (GWh)</th>
              <th className="py-3.5 px-4 text-right">EB41B (GWh)</th>
              <th className="py-3.5 px-4 text-right">EB42A (GWh)</th>
              <th className="py-3.5 px-4 text-right">EB42B (GWh)</th>
              <th className="py-3.5 px-4 text-right">{t.monthlyEnergy}</th>
              <th className="py-3.5 px-4 text-center">Status</th>
              <th className="py-3.5 px-4 text-right">{t.timestamp}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {filteredAndSortedLogs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500 italic">{t.noResults}</td>
              </tr>
            ) : (
              filteredAndSortedLogs.map((log, idx) => {
                const prevLog = logs.find(l => l.month === logs.find(sl => sl.month < log.month)?.month);
                
                let diffA = 0, diffB = 0, diffC = 0, diffD = 0;
                if (prevLog && log.air.eb41a !== null && prevLog.air.eb41a !== null) {
                  diffA = Math.max(0, log.air.eb41a - prevLog.air.eb41a);
                  diffB = Math.max(0, (log.air.eb41b || 0) - (prevLog.air.eb41b || 0));
                  diffC = Math.max(0, (log.air.eb42a || 0) - (prevLog.air.eb42a || 0));
                  diffD = Math.max(0, (log.air.eb42b || 0) - (prevLog.air.eb42b || 0));
                }
                const airEnergyKwh = (diffA + diffB + diffC + diffD) * 1000000;
                const statuses = resolveStatuses(log);

                return (
                  <tr key={idx} className="hover:bg-slate-900/35 transition-colors">
                    <td className="py-3 px-4 font-mono font-semibold text-slate-200">{formatMonthYear(log.month)}</td>
                    <td className="py-3 px-4 text-right font-mono">{log.air.eb41a !== null ? log.air.eb41a.toFixed(6) : "—"}</td>
                    <td className="py-3 px-4 text-right font-mono">{log.air.eb41b !== null ? log.air.eb41b.toFixed(6) : "—"}</td>
                    <td className="py-3 px-4 text-right font-mono">{log.air.eb42a !== null ? log.air.eb42a.toFixed(6) : "—"}</td>
                    <td className="py-3 px-4 text-right font-mono">{log.air.eb42b !== null ? log.air.eb42b.toFixed(6) : "—"}</td>
                    <td className="py-3 px-4 text-right font-mono text-teal-400 font-bold">
                      {airEnergyKwh > 0 ? `${airEnergyKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh` : "—"}
                    </td>
                    <td className="py-3 px-4 text-center space-x-1.5 whitespace-nowrap">
                      {renderEditBadge(statuses.editStatus)}
                      {renderSyncBadge(statuses.syncStatus)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-500 text-[10px]">{log.lastSavedAir || "—"}</td>
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
        const v = p.voltage || 0;
        const a = p.current || 0;
        const dcPowerW = v * a;
        const acPowerW = dcPowerW * 1.10;
        const energyKwh = (acPowerW * 24 * days) / 1000;

        rows.push({
          monthLabel,
          panelId: p.panelId,
          voltage: p.voltage,
          current: p.current,
          dcPowerW,
          acPowerW,
          energyKwh,
          timestamp: log.lastSavedDc,
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
              <th className="py-3.5 px-4 text-center">Status</th>
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
                  <td className="py-2.5 px-4 font-mono font-semibold text-slate-200">{r.monthLabel}</td>
                  <td className="py-2.5 px-4 text-amber-400 font-semibold">{r.panelId}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-orange-200">{r.voltage !== null ? r.voltage : "—"}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-orange-200">{r.current !== null ? r.current : "—"}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{r.dcPowerW > 0 ? `${r.dcPowerW.toLocaleString(undefined, { maximumFractionDigits: 1 })} W` : "—"}</td>
                  <td className="py-2.5 px-4 text-right font-mono">{r.acPowerW > 0 ? `${r.acPowerW.toLocaleString(undefined, { maximumFractionDigits: 1 })} W` : "—"}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-300 font-bold">{r.energyKwh > 0 ? `${r.energyKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh` : "—"}</td>
                  <td className="py-2.5 px-4 text-center space-x-1.5 whitespace-nowrap">
                    {renderEditBadge(r.statuses.editStatus)}
                    {renderSyncBadge(r.statuses.syncStatus)}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-500 text-[10px]">{r.timestamp || "—"}</td>
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
              <th className="py-3.5 px-4 text-right">Building Energy (kWh)</th>
              <th className="py-3.5 px-4 text-right">Building Cost (THB)</th>
              <th className="py-3.5 px-4 text-right">4th Fl. Energy (kWh)</th>
              <th className="py-3.5 px-4 text-right">4th Fl. Cost (THB)</th>
              <th className="py-3.5 px-4 text-right">Rate (฿/kWh)</th>
              <th className="py-3.5 px-4 text-right">Share (%)</th>
              <th className="py-3.5 px-4 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-850">
            {filteredAndSortedLogs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500 italic">{t.noResults}</td>
              </tr>
            ) : (
              filteredAndSortedLogs.map((log, idx) => {
                const days = getDaysInMonth(log.month);
                const upsKwh = log.ups.reduce((acc, u) => acc + (u.loadKw || 0), 0) * 24 * days;

                const prevLog = logs.find(l => l.month === logs.find(sl => sl.month < log.month)?.month);
                let airKwh = 0;
                if (prevLog && log.air.eb41a !== null && prevLog.air.eb41a !== null) {
                  const diffA = Math.max(0, log.air.eb41a - prevLog.air.eb41a);
                  const diffB = Math.max(0, (log.air.eb41b || 0) - (prevLog.air.eb41b || 0));
                  const diffC = Math.max(0, (log.air.eb42a || 0) - (prevLog.air.eb42a || 0));
                  const diffD = Math.max(0, (log.air.eb42b || 0) - (prevLog.air.eb42b || 0));
                  airKwh = (diffA + diffB + diffC + diffD) * 1000000;
                }

                const dcKwh = log.dc.reduce((acc, p) => {
                  const v = p.voltage || 0;
                  const a = p.current || 0;
                  return acc + (v * a * 1.10 * 24 * days) / 1000;
                }, 0);

                const floorEnergyKwh = upsKwh + airKwh + dcKwh;
                const bEnergy = log.energyCost.buildingEnergyKwh || 0;
                const bCost = log.energyCost.buildingElectricityCostThb || 0;
                const rate = bEnergy > 0 ? bCost / bEnergy : 0;
                const floorCostThb = floorEnergyKwh * rate;
                const sharePercent = bEnergy > 0 ? (floorEnergyKwh / bEnergy) * 100 : 0;
                const statuses = resolveStatuses(log);

                return (
                  <tr key={idx} className="hover:bg-slate-900/35 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-200">{formatMonthYear(log.month)}</td>
                    <td className="py-3.5 px-4 text-right font-mono">{bEnergy > 0 ? bEnergy.toLocaleString() : "—"}</td>
                    <td className="py-3.5 px-4 text-right font-mono">{bCost > 0 ? `฿${bCost.toLocaleString(undefined, { maximumFractionDigits: 1 })}` : "—"}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-indigo-400 font-semibold">{floorEnergyKwh > 0 ? floorEnergyKwh.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-emerald-400 font-semibold">{floorCostThb > 0 ? `฿${floorCostThb.toLocaleString(undefined, { maximumFractionDigits: 1 })}` : "—"}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-amber-300 font-medium">{rate > 0 ? rate.toFixed(4) : "—"}</td>
                    <td className="py-3.5 px-4 text-right font-mono text-teal-400 font-bold">{sharePercent > 0 ? `${sharePercent.toFixed(2)}%` : "—"}</td>
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
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Year Filter</label>
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
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Month Filter</label>
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
            <label className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Sorting Chronological</label>
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
            <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Filtered Records</span>
            <strong className="text-base font-mono text-indigo-400">{filteredAndSortedLogs.length} months</strong>
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
          {logs.slice(0, 10).map((log) => (
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
            { id: "energy", label: t.tabEnergy, icon: Coins, color: "text-emerald-400" }
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
      </div>

    </div>
  );
}
