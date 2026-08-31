import React, { useMemo } from "react";
import { MonthlyLog, UpsRecord, AirRecord, DcRecord } from "../types";
import { useReport } from "../ReportContext";
import type { DashboardUpsMappingReport, RackCapacitySummary } from "../reports/reportTypes";
import type { FacilityEntry } from "../desktop";
import { formatMonthYear } from "../utils";
import { calculateEnergyCostForMonth, getAirValue } from "../utils/energyCost";
import { buildEngineeringDashboardSnapshot, getDaysInMonth, getPreviousMonth } from "../utils/engineeringDashboard";
import { formatFixedNumber, formatNumber2 } from "../utils/numberFormatBridge";
import { 
  TrendingUp, 
  Zap, 
  Thermometer, 
  Database, 
  Coins,
  Percent,
  Calendar,
  Layers,
  ChevronDown,
  ChevronUp,
  BarChart4,
  Activity
} from "lucide-react";

interface DashboardSummaryProps {
  logs: MonthlyLog[];
  selectedMonth: string;
  lang: "th" | "en";
  isGoogleConnected?: boolean;
  googleUserEmail?: string | null;
  dataSourceLabel?: string | null;
  rackCapacity?: RackCapacitySummary | null;
  /** UPS Summary / UPS Mapping, read directly from the workbook's Dashboard-FAC sheet. */
  upsMapping?: DashboardUpsMappingReport | null;
  /** Active facility (kept for future facility-level dashboard concerns). */
  facility?: FacilityEntry | null;
}

function getUpsLoadTone(loadPct: number | null): { bar: string; text: string } {
  if (!Number.isFinite(loadPct) || loadPct < 50) return { bar: "bg-emerald-500", text: "text-emerald-500" };
  if (loadPct < 80) return { bar: "bg-amber-400", text: "text-amber-500" };
  return { bar: "bg-rose-500", text: "text-rose-500" };
}

interface DashboardComparisonReference {
  label: string;
  buildingEnergyKwh: number | null;
  buildingCostThb: number | null;
  floorEnergyKwh: number | null;
  floorCostThb: number | null;
  averageRateThbPerKwh: number | null;
  floorSharePercent: number | null;
}

function buildDashboardComparisonReference(
  logs: MonthlyLog[],
  selectedMonth: string,
  mode: "none" | "prev_month" | "prev_year" | "rolling_avg" | "best_worst"
): DashboardComparisonReference | null {
  if (mode === "none") return null;

  const metricFor = (month: string): DashboardComparisonReference | null => {
    const result = calculateEnergyCostForMonth(logs, month);
    if (!logs.some(log => log.month === month)) return null;
    return {
      label: month,
      buildingEnergyKwh: result.buildingEnergyKwh,
      buildingCostThb: result.buildingElectricityCostThb,
      floorEnergyKwh: result.floorEnergyKwh,
      floorCostThb: result.floorElectricityCostThb,
      averageRateThbPerKwh: result.averageElectricityRateThbPerKwh,
      floorSharePercent: result.energySharePercent,
    };
  };

  const average = (rows: DashboardComparisonReference[], key: keyof Omit<DashboardComparisonReference, "label">): number | null => {
    const values = rows.map(row => row[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };

  if (mode === "prev_month") {
    const previousMonth = getPreviousMonth(selectedMonth);
    const previous = metricFor(previousMonth);
    return previous ? { ...previous, label: `Previous Month · ${previousMonth}` } : null;
  }

  if (mode === "prev_year") {
    const [year, month] = selectedMonth.split("-");
    const previousYearMonth = `${Number(year) - 1}-${month}`;
    const previous = metricFor(previousYearMonth);
    return previous ? { ...previous, label: `Previous Year · ${previousYearMonth}` } : null;
  }

  const chronological = [...logs].sort((a, b) => a.month.localeCompare(b.month));
  if (mode === "rolling_avg") {
    const previousRows = chronological
      .filter(log => log.month < selectedMonth)
      .slice(-3)
      .map(log => metricFor(log.month))
      .filter((row): row is DashboardComparisonReference => row !== null);
    if (previousRows.length === 0) return null;
    return {
      label: `Rolling Average · ${previousRows.length} months`,
      buildingEnergyKwh: average(previousRows, "buildingEnergyKwh"),
      buildingCostThb: average(previousRows, "buildingCostThb"),
      floorEnergyKwh: average(previousRows, "floorEnergyKwh"),
      floorCostThb: average(previousRows, "floorCostThb"),
      averageRateThbPerKwh: average(previousRows, "averageRateThbPerKwh"),
      floorSharePercent: average(previousRows, "floorSharePercent"),
    };
  }

  const historyRows = chronological
    .map(log => metricFor(log.month))
    .filter((row): row is DashboardComparisonReference => row !== null && row.floorEnergyKwh !== null);
  if (historyRows.length === 0) return null;
  const best = historyRows.reduce((row, candidate) => (candidate.floorEnergyKwh! < row.floorEnergyKwh! ? candidate : row));
  const worst = historyRows.reduce((row, candidate) => (candidate.floorEnergyKwh! > row.floorEnergyKwh! ? candidate : row));
  return { ...worst, label: `Best / Worst · ${best.label} / ${worst.label}` };
}

export default function DashboardSummary({ logs, selectedMonth, lang, isGoogleConnected = false, googleUserEmail = null, dataSourceLabel = null, rackCapacity = null, upsMapping = null, facility = null }: DashboardSummaryProps) {
  const {
    selectedTrend,
    selectedCategory,
    selectedUPSGroup,
    compareMode,
  } = useReport();
  // RC3: sections are always expanded (no hidden accordion).

  const dict = {
    th: {
      title: "สรุปแดชบอร์ดพลังงานอาคาร",
      subtitle: "วิเคราะห์ภาพรวมการทำงานและประสิทธิภาพการใช้ไฟฟ้าของศูนย์ข้อมูล DCM ชั้น 4",
      noData: "ไม่มีข้อมูลเพียงพอสำหรับแสดงรายงานสรุป",
      noDataDesc: "กรุณากรอกข้อมูลในเมนูกรอกข้อมูลให้ครบถ้วนเพื่อเปิดใช้งานแดชบอร์ด",
      
      // Sections
      upsSection: "1. สถานะโหลด UPS — DCM ชั้น 4",
      airSection: "2. การใช้พลังงานระบบปรับอากาศ — ชั้น 4",
      dcSection: "3. สถานะโหลดแผงจ่ายไฟฟ้ากระแสตรง (DC Power Panel)",
      overallSection: "4. ภาพรวมการใช้พลังงานและค่าไฟฟ้าชั้น 4",
      
      // Table headers
      no: "ลำดับ",
      upsGroup: "กลุ่ม UPS",
      totalKw: "โหลดรวม (kW)",
      totalKva: "โหลดรวม (kVA)",
      capacity: "พิกัด UPS (kVA)",
      loadPercent: "โหลด (%)",
      availablePercent: "ว่าง (%)",
      monthlyEnergy: "พลังงานต่อเดือน (kWh)",
      
      // Mapping detailed headers
      umdb: "UMDB",
      upsId: "เครื่อง UPS",
      acPowerPanel: "แผงจ่ายไฟ AC (Power Panel)",
      sts: "STS",
      oudb: "OUDB",
      voltage: "แรงดัน (V)",
      current: "กระแส (A)",
      
      // AC Headers
      repMonth: "เดือนที่รายงาน",
      monthlyDiff: "ผลต่างรายเดือน",
      totalAcKwh: "พลังงานปรับอากาศรวม (kWh)",
      
      // DC Headers
      dcPanel: "แผงไฟฟ้า DC",
      dcPower: "กำลังไฟฟ้า DC (W)",
      acCurrent: "กระแส AC @220V (A)",
      acPower: "กำลังไฟฟ้า AC (W)",
      
      // Overall Energy & Cost
      buildingEnergy: "การใช้พลังงานทั้งอาคาร (kWh)",
      buildingCost: "ค่าไฟฟ้าทั้งอาคาร (บาท)",
      floorEnergy: "การใช้พลังงานชั้น 4 (kWh)",
      floorCost: "ค่าไฟฟ้าชั้น 4 (บาท)",
      avgRate: "อัตราค่าไฟเฉลี่ย (บาท/kWh)",
      floorShare: "สัดส่วนพลังงานชั้น 4 (%)",
      
      // Trend Section
      trendTitle: "เทรนด์และสถิติย้อนหลัง",
      trendDesc: "วิเคราะห์การใช้พลังงานแบบแยกประเภท เลือกช่วงเวลาเปรียบเทียบได้ตามต้องการ",
      last3: "ย้อนหลัง 3 เดือน",
      last6: "ย้อนหลัง 6 เดือน",
      last12: "ย้อนหลัง 12 เดือน",
      metricLabel: "เลือกตัวชี้วัด",
      
      // Metric translations
      total_energy: "พลังงานชั้น 4 ทั้งหมด (kWh)",
      ups_energy: "พลังงานระบบ UPS (kWh)",
      air_energy: "พลังงานเครื่องปรับอากาศ (kWh)",
      dc_energy: "พลังงานระบบ DC (kWh)",
      floor_cost: "ประมาณการค่าไฟชั้น 4 (บาท)",
      electricity_rate: "อัตราค่าไฟเฉลี่ย (บาท/kWh)",

      daysInMonthText: "จำนวนวันในเดือนนี้"
    },
    en: {
      title: "Building Energy Dashboard",
      subtitle: "Comprehensive analytics of power operation & efficiency for DCM 4th Floor",
      noData: "No data for selected facility and reporting month",
      noDataDesc: "Please enter logs in the Data Entry sheet to activate this dashboard.",
      
      // Sections
      upsSection: "1. UPS Load Status — DCM 4th Floor",
      airSection: "2. Air Conditioning Energy Consumption — 4th Floor",
      dcSection: "3. DC Power Panel Load Status",
      overallSection: "4. Overall Energy Consumption & Electricity Cost",
      
      // Table headers
      no: "No.",
      upsGroup: "UPS Group",
      totalKw: "Total Load (kW)",
      totalKva: "Total Load (kVA)",
      capacity: "UPS Capacity (kVA)",
      loadPercent: "Load (%)",
      availablePercent: "Available (%)",
      monthlyEnergy: "Monthly Energy (kWh)",
      
      // Mapping detailed headers
      umdb: "UMDB",
      upsId: "UPS ID",
      acPowerPanel: "AC Power Panel",
      sts: "STS",
      oudb: "OUDB",
      voltage: "Voltage (V)",
      current: "Current (A)",
      
      // AC Headers
      repMonth: "Reporting Month",
      monthlyDiff: "Monthly Difference",
      totalAcKwh: "Total AC Energy (kWh)",
      
      // DC Headers
      dcPanel: "DC Power Panel",
      dcPower: "DC Power (W)",
      acCurrent: "AC Current @220V (A)",
      acPower: "AC Power (W)",
      
      // Overall Energy & Cost
      buildingEnergy: "Building Energy (kWh)",
      buildingCost: "Building Cost (THB)",
      floorEnergy: "4th Floor Energy (kWh)",
      floorCost: "4th Floor Cost (THB)",
      avgRate: "Avg Rate (THB/kWh)",
      floorShare: "4th Floor Share (%)",
      
      // Trend Section
      trendTitle: "Trend Analytics & Historical Charts",
      trendDesc: "Interactive trends across facility parameters by custom duration blocks.",
      last3: "Last 3 Months",
      last6: "Last 6 Months",
      last12: "Last 12 Months",
      metricLabel: "Select Parameter",
      
      // Metric translations
      total_energy: "Total 4th Floor Energy (kWh)",
      ups_energy: "UPS System Energy (kWh)",
      air_energy: "Air Conditioning Energy (kWh)",
      dc_energy: "DC Power Panel Energy (kWh)",
      floor_cost: "Estimated 4th Floor Cost (THB)",
      electricity_rate: "Avg Electricity Rate (THB/kWh)",

      daysInMonthText: "Days in selected month"
    }
  };

  const t = dict[lang];

  // Helper: Find log for selected month
  const activeLog = useMemo(() => {
    return logs.find(l => l.month === selectedMonth) || null;
  }, [logs, selectedMonth]);

  // Helper: Find previous month log dynamically
  const prevMonthLog = useMemo(() => {
    if (!selectedMonth) return null;
    const targetPrevStr = getPreviousMonth(selectedMonth);
    return logs.find(l => l.month === targetPrevStr) || null;
  }, [logs, selectedMonth]);

  // Calculations for current month days
  const daysInMonth = useMemo(() => {
    return getDaysInMonth(selectedMonth);
  }, [selectedMonth]);

  // The same selected-month calculation is also used by the printable report.
  const summaryCalculations = useMemo(() => {
    const snapshot = buildEngineeringDashboardSnapshot(logs, selectedMonth, upsMapping, facility?.profile.dashboard);
    if (!snapshot) return null;
    return {
      ...snapshot,
      computedUpsGroups: snapshot.upsGroups.map(group => ({ ...group, loadPct: group.loadPercent, availPct: group.availablePercent })),
      upsDetailsMap: snapshot.upsDetails.map(row => ({ ...row, loadPct: row.loadPercent })),
      airDiff: snapshot.airDifference,
      computedDc: snapshot.dcPanels,
      totalFloorEnergyKwh: snapshot.floorEnergyKwh,
      avgElectricityRate: snapshot.averageRateThbPerKwh,
      estimatedFloorCostThb: snapshot.floorCostThb,
      prevMonthDisplay: snapshot.previousMonth ? formatMonthYear(snapshot.previousMonth) : null
    };
  }, [logs, selectedMonth, upsMapping, facility]);

  if (!activeLog || !summaryCalculations) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-12 rounded-2xl text-center space-y-4 max-w-4xl mx-auto">
        <Activity className="w-12 h-12 text-slate-500 mx-auto animate-pulse" />
        <h3 className="font-display font-semibold text-slate-200 text-lg">{t.noData}</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">{t.noDataDesc}</p>
      </div>
    );
  }

  const baseCalcs = summaryCalculations;

  // The UPS Group selector accepts both configured group names and individual
  // UPS IDs. Resolve an individual ID back to its configured group so every
  // related summary table, total, and load bar uses the same filter.
  const normalizeUpsId = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const selectedUpsConfig = (facility?.profile.dashboard.upsGroups ?? []).find(group =>
    group.name === selectedUPSGroup || group.ids.some(id => normalizeUpsId(id) === normalizeUpsId(selectedUPSGroup))
  );
  const selectedGroupName = selectedUpsConfig?.name ?? selectedUPSGroup;
  const matchesGroup = (name: string) => selectedUPSGroup === "All" || name === selectedGroupName;
  const visibleComputedUpsGroups = baseCalcs.computedUpsGroups.filter(group => matchesGroup(group.name));
  const visibleUpsOverallGroups = baseCalcs.upsOverallGroups.filter(group => matchesGroup(group.name));
  const visibleUpsDetails = baseCalcs.upsDetailsMap.filter(row => {
    if (selectedUPSGroup === "All") return true;
    if (selectedUpsConfig) {
      return selectedUpsConfig.ids.some(id => normalizeUpsId(id) === normalizeUpsId(row.upsId));
    }
    return normalizeUpsId(row.upsId) === normalizeUpsId(selectedUPSGroup);
  });
  const calcs = {
    ...baseCalcs,
    computedUpsGroups: visibleComputedUpsGroups,
    upsOverallGroups: visibleUpsOverallGroups,
    upsDetailsMap: visibleUpsDetails,
    totalUpsKw: visibleComputedUpsGroups.reduce((sum, group) => sum + group.totalKw, 0),
    totalUpsKva: visibleComputedUpsGroups.reduce((sum, group) => sum + group.totalKva, 0),
    totalUpsEnergyKwh: visibleComputedUpsGroups.reduce((sum, group) => sum + group.monthlyEnergyKwh, 0),
  };
  const showAcPowerPanel = calcs.upsDetailsMap.some(row => row.acPowerPanel !== "—" && row.acPowerPanel !== "-");
  const hasOverallUps = calcs.upsOverallGroups.length > 0;
  const showUpsSection = selectedCategory === "All" || selectedCategory === "UPS";
  const showAirSection = selectedCategory === "All" || selectedCategory === "Air Conditioning";
  const showDcSection = selectedCategory === "All" || selectedCategory === "DC";
  const showOverallSection = selectedCategory === "All" || selectedCategory === "Energy Cost" || selectedCategory === "PUE" || selectedCategory === "Carbon";

  const comparisonReference = buildDashboardComparisonReference(logs, selectedMonth, compareMode);

  return (
    <div className="space-y-10">
      
      {/* SUMMARY DASHBOARD BANNER */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase rounded-full tracking-wider">
              {formatMonthYear(selectedMonth)} Summary View
            </span>
            {dataSourceLabel ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-sky-500/10 border border-sky-500/20 text-[10px] font-semibold text-sky-300 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                {dataSourceLabel}
              </span>
            ) : isGoogleConnected ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-semibold text-emerald-400 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                {lang === "th" ? `ข้อมูลหลัก: Google Sheets (${googleUserEmail})` : `Primary Source: Google Sheets (${googleUserEmail})`}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-[10px] font-semibold text-amber-400 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                {lang === "th" ? "ใช้ข้อมูลออฟไลน์ชั่วคราว (เชื่อมต่อ Google Sheets เพื่อซิงค์)" : "Offline Mode (Connect Google Sheets for primary history)"}
              </span>
            )}
          </div>
          <h2 className="text-xl font-display font-bold text-slate-100 mt-2 flex items-center gap-2">
            <BarChart4 className="w-5 h-5 text-indigo-400" />
            <span>{t.title}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {t.subtitle}
          </p>
          <p data-testid="dashboard-filter-state" className="text-[10px] text-slate-500 mt-2 font-mono">
            Trend: {selectedTrend} · Category: {selectedCategory} · UPS Group: {selectedUPSGroup} · Compare: {compareMode}
          </p>
        </div>

        <div className="bg-slate-950 px-4 py-3 rounded-xl border border-slate-850 flex items-center gap-3">
          <Calendar className="w-4 h-4 text-emerald-400" />
          <div className="text-left">
            <div className="text-[10px] uppercase font-mono text-slate-400 font-semibold leading-none">{t.daysInMonthText}</div>
            <strong className="text-sm font-mono text-slate-200">{daysInMonth} {lang === "th" ? "วัน" : "Days"}</strong>
          </div>
        </div>
      </div>

      {/* OVERALL KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-2">
          <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>{lang === "th" ? "พลังงานชั้น 4 ทั้งหมด" : "Total 4th Floor Energy"}</span>
          </p>
          <h3 className="text-2xl font-mono font-bold text-indigo-400">
            {formatNumber2(calcs.totalFloorEnergyKwh)} <span className="text-xs font-sans">kWh</span>
          </h3>
          <p className="text-[10px] text-slate-400 leading-none">
              {lang === "th" ? "แผง UPS + AC + DC" : "UPS + AC + DC Power Panels"}
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-2">
          <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-emerald-400" />
            <span>{lang === "th" ? "ประมาณการค่าไฟชั้น 4" : "Estimated 4th Floor Cost"}</span>
          </p>
          <h3 className="text-2xl font-mono font-bold text-emerald-400">
            {calcs.estimatedFloorCostThb === null ? "—" : `฿${formatNumber2(calcs.estimatedFloorCostThb)}`}
          </h3>
          <p className="text-[10px] text-slate-400 leading-none">
            {lang === "th" ? "อิงอัตราค่าไฟเฉลี่ยอาคาร" : "Calculated from avg building rate"}
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-2">
          <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider flex items-center gap-1.5">
            <Percent className="w-3.5 h-3.5 text-teal-400" />
            <span>{lang === "th" ? "สัดส่วนพลังงานชั้น 4" : "4th Floor Energy Share"}</span>
          </p>
          <h3 className="text-2xl font-mono font-bold text-teal-400">
            {calcs.floorSharePercent === null ? "—" : `${formatNumber2(calcs.floorSharePercent)}%`}
          </h3>
          <p className="text-[10px] text-slate-400 leading-none">
            {lang === "th" ? `จากพลังงานอาคาร ${formatNumber2(calcs.buildingEnergyKwh)} kWh` : `Of total building ${formatNumber2(calcs.buildingEnergyKwh)} kWh`}
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-2">
          <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
            <span>{lang === "th" ? "อัตราค่าไฟเฉลี่ยอาคาร" : "Avg Electricity Rate"}</span>
          </p>
          <h3 className="text-2xl font-mono font-bold text-amber-400">
            {formatNumber2(calcs.avgElectricityRate)} <span className="text-xs font-sans">฿/kWh</span>
          </h3>
          <p className="text-[10px] text-slate-400 leading-normal">
            {lang === "th" ? `ค่าไฟอาคาร: ${calcs.buildingCostThb === null ? "—" : `฿${formatNumber2(calcs.buildingCostThb)}`}` : `Building cost: ${calcs.buildingCostThb === null ? "—" : `฿${formatNumber2(calcs.buildingCostThb)}`}`}
          </p>
          <p className="text-[9px] text-slate-500 font-mono leading-tight border-t border-slate-800/60 pt-1.5">
            {lang === "th" 
              ? "สูตร: อัตราค่าไฟ (บาท/kWh) = ค่าไฟฟ้าอาคาร (บาท) / การใช้พลังงานอาคาร (kWh)"
              : "Formula: Rate = Building Cost (THB) / Building Energy (kWh)"}
          </p>
        </div>
      </div>

      {/* Rack Capacity now has its own dedicated tab (see RackCapacityEditor). */}

      {/* DETAILED ACCORDION BLOCKS */}
      <div className="space-y-4">
        
        {/* SECTION 1: UPS LOAD STATUS */}
        {showUpsSection && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <button 
            type="button"
            className="w-full px-5 py-4 flex justify-between items-center bg-slate-900 hover:bg-slate-850 transition-colors text-left font-display font-bold text-slate-200 cursor-pointer text-sm"
          >
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>{hasOverallUps ? (lang === "th" ? "1. สถานะโหลด UPS" : "1. UPS Load Status") : t.upsSection}</span>
            </div>
            
          </button>

          {(
            <div className="p-5 border-t border-slate-850 bg-slate-950/40 space-y-6">
              
              {/* Table 1: Summary UPS */}
              {hasOverallUps && (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{lang === "th" ? "1.1 สถานะโหลด UPS - รวม" : "1.1 UPS Load Status - Overall"}</h4>
                  <table className="dashboard-table w-full text-left text-xs font-sans">
                    <thead><tr className="border-b border-slate-800 text-slate-400 tracking-wider text-[10px] font-bold">
                      <th className="py-2.5 px-3">{t.no}</th><th className="py-2.5 px-3">UPS</th><th className="py-2.5 px-3">{t.totalKw}</th><th className="py-2.5 px-3">{t.totalKva}</th><th className="py-2.5 px-3">{t.capacity}</th><th className="py-2.5 px-3">{t.loadPercent}</th><th className="py-2.5 px-3">{t.availablePercent}</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-850">
                      {calcs.upsOverallGroups.map((group, index) => <tr key={group.name} className="hover:bg-slate-900/40"><td className="py-3 px-3 font-mono">{index + 1}</td><td className="py-3 px-3 font-semibold">{group.name}</td><td className="py-3 px-3 font-mono">{formatNumber2(group.totalKw)}</td><td className="py-3 px-3 font-mono">{formatNumber2(group.totalKva)}</td><td className="py-3 px-3 font-mono">{formatNumber2(group.capacity)}</td><td className="py-3 px-3 font-mono">{formatNumber2(group.loadPercent)}%</td><td className="py-3 px-3 font-mono">{formatNumber2(group.availablePercent)}%</td></tr>)}
                    </tbody>
                  </table>
                  </div>
                  <div className="bg-slate-900/80 border border-slate-850 p-4 rounded-xl">
                    <div className="space-y-1 mb-4">
                      <h4 className="text-[11px] uppercase tracking-wider font-bold text-indigo-400">{lang === "th" ? "เปรียบเทียบโหลด UPS (%) - รวม" : "UPS Loads Comparison (%) - Overall"}</h4>
                      <p className="text-[10px] text-slate-500">{lang === "th" ? "เปรียบเทียบโหลดปัจจุบันกับพิกัดสูงสุด" : "Current load capacity compared with rated maximum"}</p>
                    </div>
                    <div className="space-y-3.5">
                      {calcs.upsOverallGroups.map((group) => {
                        const tone = getUpsLoadTone(group.loadPercent);
                        return <div key={group.name} className="space-y-1.5">
                          <div className="flex justify-between text-[11px] font-semibold text-slate-300"><span>{group.name}</span><span className={`font-mono ${tone.text}`}>{formatNumber2(group.loadPercent)}%</span></div>
                          <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-850/50"><div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, group.loadPercent ?? 0)}%` }} /></div>
                        </div>;
                      })}
                    </div>
                  </div>
                </div>
              )}
              {hasOverallUps && <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{lang === "th" ? "1.2 สถานะโหลด UPS และ PPC – DCM ชั้น 4" : "1.2 UPS and PPC Load Status – DCM 4th Floor"}</h4>}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-8 overflow-x-auto">
                  <table className="dashboard-table w-full text-left text-xs font-sans">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 tracking-wider text-[10px] font-bold">
                        <th className="py-2.5 px-3">{t.no}</th>
                        <th className="py-2.5 px-3">{t.upsGroup}</th>
                        <th className="py-2.5 px-3 text-right">{t.totalKw}</th>
                        <th className="py-2.5 px-3 text-right">{t.totalKva}</th>
                        <th className="py-2.5 px-3 text-right">{t.capacity}</th>
                        <th className="py-2.5 px-3 text-right">{t.loadPercent}</th>
                        <th className="py-2.5 px-3 text-right">{t.availablePercent}</th>
                        <th className="py-2.5 px-3 text-right">{t.monthlyEnergy}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {calcs.computedUpsGroups.map((g, idx) => (
                        <tr key={idx} className="hover:bg-slate-900/40">
                          <td className="py-3 px-3 text-slate-500 font-mono font-bold">{idx + 1}</td>
                          <td className="py-3 px-3 text-slate-200 font-semibold">{g.name}</td>
                          <td className="py-3 px-3 text-right font-mono text-slate-300">{formatNumber2(g.totalKw)}</td>
                          <td className="py-3 px-3 text-right font-mono text-slate-300">{formatNumber2(g.totalKva)}</td>
                          <td className="py-3 px-3 text-right font-mono text-slate-400">{formatNumber2(g.capacity)}</td>
                          <td className="py-3 px-3 text-right font-mono text-indigo-400 font-semibold">{formatNumber2(g.loadPct)}%</td>
                          <td className="py-3 px-3 text-right font-mono text-emerald-400">{formatNumber2(g.availPct)}%</td>
                          <td className="py-3 px-3 text-right font-mono text-indigo-300">{formatNumber2(g.monthlyEnergyKwh)}</td>
                        </tr>
                      ))}
                      {/* Total row */}
                      <tr className="border-t-2 border-slate-800 bg-slate-900/30 font-bold">
                        <td className="py-3.5 px-3" colSpan={2}>{lang === "th" ? "รวม" : "Total"}</td>
                        <td className="py-3.5 px-3 text-right font-mono text-slate-200">{formatNumber2(calcs.totalUpsKw)}</td>
                        <td className="py-3.5 px-3 text-right font-mono text-slate-200">{formatNumber2(calcs.totalUpsKva)}</td>
                        <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                        <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                        <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                        <td className="py-3.5 px-3 text-right font-mono text-indigo-400">{formatNumber2(calcs.totalUpsEnergyKwh)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Sidebar UPS bar graph rendering */}
                <div className="lg:col-span-4 bg-slate-900/80 border border-slate-850 p-4 rounded-xl flex flex-col justify-between">
                  <div className="space-y-1 mb-4">
                    <h4 className="text-[11px] uppercase tracking-wider font-bold text-indigo-400">{hasOverallUps ? (lang === "th" ? "เปรียบเทียบโหลด UPS และ PPC (%) – DCM ชั้น 4" : "UPS and PPC Loads Comparison (%) – DCM 4th Floor") : (lang === "th" ? "เปรียบเทียบโหลด UPS (%)" : "UPS Loads Comparison (%)")}</h4>
                    <p className="text-[10px] text-slate-500">{lang === "th" ? "เปรียบเทียบโหลดปัจจุบันกับพิกัดสูงสุด" : "Current load capacity compared with rated maximum"}</p>
                  </div>

                  <div className="space-y-3.5 flex-1 flex flex-col justify-center">
                    {calcs.computedUpsGroups.map((g, idx) => {
                      const tone = getUpsLoadTone(g.loadPct);
                      return <div key={idx} className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-semibold text-slate-300">
                          <span>{g.name}</span>
                          <span className={`font-mono ${tone.text}`}>{formatNumber2(g.loadPct)}%</span>
                        </div>
                        <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-850/50">
                          <div 
                            className={`h-full rounded-full ${tone.bar}`}
                            style={{ width: `${Math.min(100, g.loadPct)}%` }}
                          />
                        </div>
                      </div>
                    })}
                  </div>
                </div>
              </div>

              {/* Table 2: Mapping Detailed UPS */}
              <div className="pt-2 border-t border-slate-850/60">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{showAcPowerPanel ? (lang === "th" ? "รายละเอียดการเชื่อมโยง UMDB / UPS / แผงไฟ AC / STS / OUDB" : "UMDB / UPS / AC Power Panel / STS / OUDB Detailed Configuration Mapping") : (lang === "th" ? "รายละเอียดการเชื่อมโยง UMDB / UPS / STS / OUDB" : "UMDB / UPS / STS / OUDB Detailed Configuration Mapping")}</h4>
                <div className="overflow-x-auto">
                  <table className="dashboard-table w-full text-left text-[11px] font-sans">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500 tracking-wider text-[9px] font-bold">
                        <th className="py-2 px-2.5">{t.no}</th>
                        <th className="py-2 px-2.5">{t.umdb}</th>
                        <th className="py-2 px-2.5">{t.upsId}</th>
                        {showAcPowerPanel && <th className="py-2 px-2.5">{t.acPowerPanel}</th>}
                        <th className="py-2 px-2.5">{t.sts}</th>
                        <th className="py-2 px-2.5">{t.oudb}</th>
                        <th className="py-2 px-2.5 text-right">{t.voltage}</th>
                        <th className="py-2 px-2.5 text-right">{t.current}</th>
                        <th className="py-2 px-2.5 text-right">{t.totalKw}</th>
                        <th className="py-2 px-2.5 text-right">{t.totalKva}</th>
                        <th className="py-2 px-2.5 text-right">{t.capacity}</th>
                        <th className="py-2 px-2.5 text-right">{t.loadPercent}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {calcs.upsDetailsMap.map((u) => (
                        <tr key={u.no} className="hover:bg-slate-900/30 text-slate-300">
                          <td className="py-2 px-2.5 font-mono text-slate-500">{u.no}</td>
                          <td className="py-2 px-2.5 text-slate-400 font-mono">{u.umdb}</td>
                          <td className="py-2 px-2.5 font-medium text-slate-200">{u.upsId}</td>
                          {showAcPowerPanel && <td className="py-2 px-2.5 font-mono text-slate-400">{u.acPowerPanel}</td>}
                          <td className="py-2 px-2.5 font-mono text-slate-400">{u.sts}</td>
                          <td className="py-2 px-2.5 font-mono text-slate-400">{u.oudb}</td>
                          <td className="py-2 px-2.5 text-right font-mono text-orange-200">{formatNumber2(u.voltage)}</td>
                          <td className="py-2 px-2.5 text-right font-mono text-orange-200">{formatNumber2(u.current)}</td>
                          <td className="py-2 px-2.5 text-right font-mono">{formatNumber2(u.loadKw)}</td>
                          <td className="py-2 px-2.5 text-right font-mono">{formatNumber2(u.loadKva)}</td>
                          <td className="py-2 px-2.5 text-right font-mono text-slate-500">{formatNumber2(u.capacity)}</td>
                        <td className="py-2 px-2.5 text-right font-mono text-indigo-400">{formatNumber2(u.loadPct)}%</td>
                        </tr>
                      ))}
                      {/* Detailed total row */}
                      <tr className="border-t border-slate-800 bg-slate-900/20 font-semibold text-slate-200">
                        <td className="py-2 px-2.5" colSpan={showAcPowerPanel ? 6 : 5}>{lang === "th" ? "รวม" : "Total"}</td>
                        <td className="py-2 px-2.5 text-right font-mono text-orange-200">{formatNumber2(calcs.detailedVoltageAvg)} (Avg)</td>
                        <td className="py-2 px-2.5 text-right font-mono text-orange-200">{formatNumber2(calcs.detailedCurrentSum)}</td>
                        <td className="py-2 px-2.5 text-right font-mono">{formatNumber2(calcs.totalUpsKw)}</td>
                        <td className="py-2 px-2.5 text-right font-mono">{formatNumber2(calcs.totalUpsKva)}</td>
                        <td className="py-2 px-2.5 text-right" colSpan={2}>—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}
        </div>
        )}

        {/* SECTION 2: AIR CONDITIONING */}
        {showAirSection && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <button 
            type="button"
            className="w-full px-5 py-4 flex justify-between items-center bg-slate-900 hover:bg-slate-850 transition-colors text-left font-display font-bold text-slate-200 cursor-pointer text-sm"
          >
            <div className="flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-teal-400 shrink-0" />
              <span>{t.airSection}</span>
            </div>
            
          </button>

          {(
            <div className="p-5 border-t border-slate-850 bg-slate-950/40 space-y-4">
              <div className="overflow-x-auto">
                <table className="dashboard-table w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 tracking-wider text-[10px] font-bold">
                      <th className="py-2.5 px-3">{t.repMonth}</th>
                      {calcs.airFields.map(field => <th key={field} className="py-2.5 px-3 text-right">{field.toUpperCase()} (GWh)</th>)}
                      <th className="py-2.5 px-3 text-right">{t.monthlyEnergy}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {/* Previous Month */}
                    <tr className="text-slate-400">
                      <td className="py-3 px-3 font-semibold text-slate-500">{calcs.prevMonthDisplay || (lang === "th" ? "เดือนก่อนหน้า" : "Previous Month")}</td>
                      {calcs.airFields.map(field => {
                        const value = prevMonthLog ? getAirValue(prevMonthLog, field) : null;
                        return <td key={field} className="py-3 px-3 text-right font-mono">{formatFixedNumber(value, 6)}</td>;
                      })}
                      <td className="py-3 px-3 text-right font-mono text-slate-600">—</td>
                    </tr>
                    {/* Current Month */}
                    <tr className="text-slate-200">
                      <td className="py-3 px-3 font-semibold text-teal-400">{formatMonthYear(selectedMonth)}</td>
                      {calcs.airFields.map(field => {
                        const value = getAirValue(activeLog, field);
                        return <td key={field} className="py-3 px-3 text-right font-mono">{formatFixedNumber(value, 6)}</td>;
                      })}
                      <td className="py-3 px-3 text-right font-mono text-slate-500">—</td>
                    </tr>
                    {/* Monthly Difference */}
                    <tr className="border-t-2 border-slate-800 bg-teal-950/10 font-bold text-teal-300">
                      <td className="py-3 px-3">{t.monthlyDiff}</td>
                      {calcs.airFields.map(field => {
                        const value = calcs.airDiff[field];
                        return <td key={field} className="py-3 px-3 text-right font-mono">{formatFixedNumber(value, 6)}</td>;
                      })}
                      <td className="py-3 px-3 text-right font-mono text-emerald-400">{calcs.airEnergyKwh === null ? "—" : `${formatNumber2(calcs.airEnergyKwh)} kWh`}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-400 mt-2 font-sans italic">
                * {lang === "th" ? "พลังงานที่ใช้ของเครื่องปรับอากาศคำนวณจากผลต่างของตัวเลขมิเตอร์ (GWh) คูณด้วย 1,000,000 เพื่อแปลงค่าเป็น kWh" : "Air conditioning energy consumption is calculated using GWh meter difference multiplied by 1,000,000 to convert to kWh units."}
              </p>
            </div>
          )}
        </div>
        )}

        {/* SECTION 3: DC POWER PANELS */}
        {showDcSection && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <button 
            type="button"
            className="w-full px-5 py-4 flex justify-between items-center bg-slate-900 hover:bg-slate-850 transition-colors text-left font-display font-bold text-slate-200 cursor-pointer text-sm"
          >
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{t.dcSection}</span>
            </div>
            
          </button>

          {(
            <div className="p-5 border-t border-slate-850 bg-slate-950/40 space-y-4">
              <div className="overflow-x-auto">
                <table className="dashboard-table w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 tracking-wider text-[10px] font-bold">
                      <th className="py-2.5 px-3">{t.no}</th>
                      <th className="py-2.5 px-3">{t.dcPanel}</th>
                      <th className="py-2.5 px-3 text-right">{t.voltage}</th>
                      <th className="py-2.5 px-3 text-right">{t.current}</th>
                      <th className="py-2.5 px-3 text-right">{t.dcPower}</th>
                      <th className="py-2.5 px-3 text-right">{t.acCurrent}</th>
                      <th className="py-2.5 px-3 text-right">{t.acPower}</th>
                      <th className="py-2.5 px-3 text-right">{t.monthlyEnergy}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {calcs.computedDc.map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/30">
                        <td className="py-3 px-3 text-slate-500 font-mono font-bold">{idx + 1}</td>
                        <td className="py-3 px-3 text-slate-200 font-semibold">{p.panelId}</td>
                        <td className="py-3 px-3 text-right font-mono text-orange-200">{formatNumber2(p.voltage)}</td>
                        <td className="py-3 px-3 text-right font-mono text-orange-200">{formatNumber2(p.current)}</td>
                        <td className="py-3 px-3 text-right font-mono text-slate-300">{formatNumber2(p.dcPowerW)}</td>
                        <td className="py-3 px-3 text-right font-mono text-amber-300">{formatNumber2(p.acCurrentA)}</td>
                        <td className="py-3 px-3 text-right font-mono text-amber-200">{formatNumber2(p.acPowerW)}</td>
                        <td className="py-3 px-3 text-right font-mono text-amber-400 font-medium">{formatNumber2(p.monthlyEnergyKwh)}</td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr className="border-t-2 border-slate-800 bg-amber-950/10 font-bold">
                      <td className="py-3.5 px-3" colSpan={2}>{lang === "th" ? "รวม" : "Total"}</td>
                      <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                      <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                      <td className="py-3.5 px-3 text-right font-mono text-slate-200">{formatNumber2(calcs.totalDcPowerW)}</td>
                      <td className="py-3.5 px-3 text-right font-mono text-amber-300">{formatNumber2(calcs.totalDcAcCurrentA)}</td>
                      <td className="py-3.5 px-3 text-right font-mono text-amber-200">{formatNumber2(calcs.totalDcAcPowerW)}</td>
                      <td className="py-3.5 px-3 text-right font-mono text-amber-400">{formatNumber2(calcs.totalDcEnergyKwh)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        )}

        {/* SECTION 4: OVERALL ENERGY & COST */}
        {showOverallSection && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <button 
            type="button"
            className="w-full px-5 py-4 flex justify-between items-center bg-slate-900 hover:bg-slate-850 transition-colors text-left font-display font-bold text-slate-200 cursor-pointer text-sm"
          >
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{t.overallSection}</span>
            </div>
            
          </button>

          {(
            <div className="p-5 border-t border-slate-850 bg-slate-950/40 space-y-4">
              <div className="overflow-x-auto">
                <table className="dashboard-table w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 tracking-wider text-[10px] font-bold">
                      <th className="py-2.5 px-3">{t.repMonth}</th>
                      <th className="py-2.5 px-3 text-right">{t.buildingEnergy}</th>
                      <th className="py-2.5 px-3 text-right">{t.buildingCost}</th>
                      <th className="py-2.5 px-3 text-right">{t.floorEnergy}</th>
                      <th className="py-2.5 px-3 text-right">{t.floorCost}</th>
                      <th className="py-2.5 px-3 text-right">{t.avgRate}</th>
                      <th className="py-2.5 px-3 text-right">{t.floorShare}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 text-slate-200">
                    <tr>
                      <td className="py-4 px-3 font-semibold text-emerald-400">{formatMonthYear(selectedMonth)}</td>
                      <td className="py-4 px-3 text-right font-mono text-slate-300">{formatNumber2(calcs.buildingEnergyKwh)}</td>
                      <td className="py-4 px-3 text-right font-mono text-slate-300">{calcs.buildingCostThb === null ? "—" : `฿${formatNumber2(calcs.buildingCostThb)}`}</td>
                      <td className="py-4 px-3 text-right font-mono text-indigo-400 font-semibold">{formatNumber2(calcs.totalFloorEnergyKwh)}</td>
                      <td className="py-4 px-3 text-right font-mono text-emerald-400 font-semibold">{calcs.estimatedFloorCostThb === null ? "—" : `฿${formatNumber2(calcs.estimatedFloorCostThb)}`}</td>
                      <td className="py-4 px-3 text-right font-mono text-amber-400 font-medium">{formatNumber2(calcs.avgElectricityRate)}</td>
                      <td className="py-4 px-3 text-right font-mono text-teal-400 font-bold">{calcs.floorSharePercent === null ? "—" : `${formatNumber2(calcs.floorSharePercent)}%`}</td>
                    </tr>
                    {comparisonReference && (
                      <tr data-testid="dashboard-comparison-row" className="border-t border-slate-800 bg-slate-900/30 text-slate-400">
                        <td className="py-4 px-3 font-semibold text-amber-300">{comparisonReference.label}</td>
                        <td className="py-4 px-3 text-right font-mono">{formatNumber2(comparisonReference.buildingEnergyKwh)}</td>
                        <td className="py-4 px-3 text-right font-mono">{comparisonReference.buildingCostThb === null ? "—" : `฿${formatNumber2(comparisonReference.buildingCostThb)}`}</td>
                        <td className="py-4 px-3 text-right font-mono">{formatNumber2(comparisonReference.floorEnergyKwh)}</td>
                        <td className="py-4 px-3 text-right font-mono">{comparisonReference.floorCostThb === null ? "—" : `฿${formatNumber2(comparisonReference.floorCostThb)}`}</td>
                        <td className="py-4 px-3 text-right font-mono">{formatNumber2(comparisonReference.averageRateThbPerKwh)}</td>
                        <td className="py-4 px-3 text-right font-mono">{comparisonReference.floorSharePercent === null ? "—" : `${formatNumber2(comparisonReference.floorSharePercent)}%`}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        )}

      </div>

    </div>
  );
}
