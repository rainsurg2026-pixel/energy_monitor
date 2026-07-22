import React, { useState, useMemo } from "react";
import { MonthlyLog, UpsRecord, AirRecord, DcRecord } from "../types";
import type { DashboardUpsMappingReport, RackCapacitySummary } from "../reports/reportTypes";
import type { FacilityEntry } from "../desktop";
import { formatMonthYear } from "../utils";
import { calculateEnergyCostForMonth, getAirFields, getAirValue } from "../utils/energyCost";
import { formatNumber2 } from "../utils/numberFormatBridge";
import TrendLineChart from "./TrendLineChart";
import RackCapacitySummaryCard from "./RackCapacitySummaryCard";
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
  rackCapacity?: RackCapacitySummary | null;
  /** UPS Summary / UPS Mapping, read directly from the workbook's Dashboard-FAC sheet. */
  upsMapping?: DashboardUpsMappingReport | null;
  /** Active facility (kept for future facility-level dashboard concerns). */
  facility?: FacilityEntry | null;
}

type TrendPeriod = "last3" | "last6" | "last12";

// Helper to calculate days in month
function getDaysInMonth(monthStr: string): number {
  if (!monthStr) return 30;
  const [yearStr, monthStrPart] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStrPart, 10);
  return new Date(year, month, 0).getDate();
}

// Get the previous month string "YYYY-MM"
function getPreviousMonthStr(monthStr: string): string {
  if (!monthStr) return "";
  const [yearStr, monthStrPart] = monthStr.split("-");
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStrPart, 10) - 1;
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return `${year}-${month.toString().padStart(2, "0")}`;
}

function getUpsLoadTone(loadPct: number | null): { bar: string; text: string } {
  if (!Number.isFinite(loadPct) || loadPct < 50) return { bar: "bg-emerald-500", text: "text-emerald-500" };
  if (loadPct < 80) return { bar: "bg-amber-400", text: "text-amber-500" };
  return { bar: "bg-rose-500", text: "text-rose-500" };
}

export default function DashboardSummary({ logs, selectedMonth, lang, isGoogleConnected = false, googleUserEmail = null, rackCapacity = null, upsMapping = null, facility = null }: DashboardSummaryProps) {
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("last12");
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
      noData: "Insufficient data to generate summary reports",
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
    const targetPrevStr = getPreviousMonthStr(selectedMonth);
    return logs.find(l => l.month === targetPrevStr) || null;
  }, [logs, selectedMonth]);

  // Calculations for current month days
  const daysInMonth = useMemo(() => {
    return getDaysInMonth(selectedMonth);
  }, [selectedMonth]);

  // Detailed calculations for active log
  const summaryCalculations = useMemo(() => {
    if (!activeLog) return null;

    // --- 1. UPS CALCULATIONS ---
    // UPS Summary and UPS Mapping are read directly from the workbook's
    // Dashboard-FAC sheet (src/reports/upsMappingReader.ts) - the same
    // UMDB/STS/OUDB/AC Power Panel/Capacity/Load(%) a user sees opening the
    // workbook in Excel. This component performs zero aggregation of its
    // own for these two tables; Load(%) is the one derived value
    // (loadKva / capacity * 100), matching the workbook's own formula.
    const computedUpsGroups = (upsMapping?.summary ?? []).map(row => {
      const totalKw = row.totalLoadKw ?? 0;
      const totalKva = row.totalLoadKva ?? 0;
      const loadPct = row.loadPercent;
      const availPct = loadPct === null ? null : Math.max(0, 100 - loadPct);
      return {
        name: row.name,
        totalKw,
        totalKva,
        capacity: row.capacity,
        loadPct,
        availPct,
        monthlyEnergyKwh: totalKw * 24 * daysInMonth
      };
    });

    const totalUpsKw = computedUpsGroups.reduce((acc, g) => acc + g.totalKw, 0);
    const totalUpsKva = computedUpsGroups.reduce((acc, g) => acc + g.totalKva, 0);
    const totalUpsEnergyKwh = computedUpsGroups.reduce((acc, g) => acc + g.monthlyEnergyKwh, 0);

    const upsDetailsMap = (upsMapping?.mapping ?? []).map(row => ({
      no: row.no,
      umdb: row.umdb,
      upsId: row.upsId,
      acPowerPanel: row.acPowerPanel,
      sts: row.sts,
      oudb: row.oudb,
      voltage: row.voltage ?? 0,
      current: row.current ?? 0,
      loadKw: row.loadKw ?? 0,
      loadKva: row.loadKva ?? 0,
      capacity: row.capacity,
      loadPct: row.loadPercent
    }));

    const detailedVoltageAvg = upsDetailsMap.length > 0
      ? upsDetailsMap.reduce((acc, u) => acc + u.voltage, 0) / upsDetailsMap.length
      : null;
    const detailedCurrentSum = upsDetailsMap.reduce((acc, u) => acc + u.current, 0);

    // --- 2. AIR CONDITIONING CALCULATIONS ---
    const airFields = getAirFields(activeLog);
    const airDiff = Object.fromEntries(airFields.map(field => {
      const currentValue = getAirValue(activeLog, field);
      const previousValue = prevMonthLog ? getAirValue(prevMonthLog, field) : null;
      return [field, currentValue !== null && previousValue !== null ? currentValue - previousValue : null];
    })) as Record<string, number | null>;

    const airDiffValues = airFields.map(field => airDiff[field]);
    const airDiffSumGwh = airDiffValues.every(value => value !== null)
      ? airDiffValues.reduce((sum, value) => sum + (value as number), 0)
      : null;
    const airEnergyKwh = airDiffSumGwh === null ? null : airDiffSumGwh * 1000000;

    // --- 3. DC POWER PANEL CALCULATIONS ---
    const computedDc = activeLog.dc.map(p => {
      const v = p.voltage === null ? 0 : p.voltage;
      const a = p.current === null ? 0 : p.current;
      const dcPowerW = v * a;
      const acPowerW = (dcPowerW / 200) * 220;
      const acCurrentA = acPowerW / 220;
      const monthlyEnergyKwh = (acPowerW * 24 * daysInMonth) / 1000;

      return {
        panelId: p.panelId,
        voltage: v,
        current: a,
        dcPowerW,
        acPowerW,
        acCurrentA,
        monthlyEnergyKwh
      };
    });

    const totalDcPowerW = computedDc.reduce((acc, d) => acc + d.dcPowerW, 0);
    const totalDcAcCurrentA = computedDc.reduce((acc, d) => acc + d.acCurrentA, 0);
    const totalDcAcPowerW = computedDc.reduce((acc, d) => acc + d.acPowerW, 0);
    const totalDcEnergyKwh = computedDc.reduce((acc, d) => acc + d.monthlyEnergyKwh, 0);

    // --- 4. OVERALL SUMMARY ---
    const energyCost = calculateEnergyCostForMonth(logs, activeLog.month);
    const totalFloorEnergyKwh = energyCost.floorEnergyKwh;
    const buildingEnergyKwh = energyCost.buildingEnergyKwh;
    const buildingCostThb = energyCost.buildingElectricityCostThb;
    const avgElectricityRate = energyCost.averageElectricityRateThbPerKwh;
    const estimatedFloorCostThb = energyCost.floorElectricityCostThb;
    const floorSharePercent = energyCost.energySharePercent;

    return {
      computedUpsGroups,
      totalUpsKw,
      totalUpsKva,
      totalUpsEnergyKwh,
      upsDetailsMap,
      detailedVoltageAvg,
      detailedCurrentSum,
      airFields,
      airDiff,
      airDiffSumGwh,
      airEnergyKwh,
      computedDc,
      totalDcPowerW,
      totalDcAcCurrentA,
      totalDcAcPowerW,
      totalDcEnergyKwh,
      totalFloorEnergyKwh,
      avgElectricityRate,
      estimatedFloorCostThb,
      floorSharePercent,
      buildingEnergyKwh,
      buildingCostThb,
      prevMonthDisplay: prevMonthLog ? formatMonthYear(prevMonthLog.month) : null
    };
  }, [activeLog, prevMonthLog, daysInMonth, upsMapping]);

  // Historical trend data is calculated once per month and reused by each
  // parameter chart. Null values remain null so incomplete records are not
  // silently rendered as zero.
  const trendDataByMetric = useMemo(() => {
    // Sort chronological
    const sortedLogs = [...logs].sort((a, b) => a.month.localeCompare(b.month));

    // Calculate full metrics for each month
    const processedMonths = sortedLogs.map((log) => {
      const energyCost = calculateEnergyCostForMonth(logs, log.month);
      const upsKwh = energyCost.upsEnergyKwh;
      const airKwh = energyCost.airEnergyKwh;
      const dcKwh = energyCost.dcEnergyKwh;
      const totalEnergy = energyCost.floorEnergyKwh;
      const bEnergy = energyCost.buildingEnergyKwh;
      const bCost = energyCost.buildingElectricityCostThb;
      const rate = energyCost.averageElectricityRateThbPerKwh;
      const floorCost = energyCost.floorElectricityCostThb;

      // Parse quarter & year
      const [yearStr, monthStr] = log.month.split("-");
      const year = parseInt(yearStr, 10);
      const monthNum = parseInt(monthStr, 10);
      const quarter = Math.ceil(monthNum / 3); // 1, 2, 3, 4

      return {
        monthStr: log.month,
        monthLabel: formatMonthYear(log.month),
        year,
        quarter: `${year}-Q${quarter}`,
        upsKwh,
        airKwh,
        dcKwh,
        totalEnergy,
        bEnergy,
        bCost,
        rate,
        floorCost
      };
    });

    // Rolling windows only (RC5): the last 3/6/12 months, monthly points.
    const windowSize = trendPeriod === "last3" ? 3 : trendPeriod === "last6" ? 6 : 12;
    const window = processedMonths.slice(-windowSize).map(d => ({
      label: d.monthLabel,
      total_energy: d.totalEnergy,
      ups_energy: d.upsKwh,
      air_energy: d.airKwh,
      dc_energy: d.dcKwh,
      floor_cost: d.floorCost,
      electricity_rate: d.rate
    }));
    return window;
  }, [logs, trendPeriod]);

  if (!activeLog || !summaryCalculations) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-12 rounded-2xl text-center space-y-4 max-w-4xl mx-auto">
        <Activity className="w-12 h-12 text-slate-500 mx-auto animate-pulse" />
        <h3 className="font-display font-semibold text-slate-200 text-lg">{t.noData}</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">{t.noDataDesc}</p>
      </div>
    );
  }

  const calcs = summaryCalculations;

  return (
    <div className="space-y-10">
      
      {/* SUMMARY DASHBOARD BANNER */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase rounded-full tracking-wider">
              {formatMonthYear(selectedMonth)} Summary View
            </span>
            {isGoogleConnected ? (
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
        </div>

        <div className="bg-slate-950 px-4 py-3 rounded-xl border border-slate-850 flex items-center gap-3">
          <Calendar className="w-4 h-4 text-emerald-400" />
          <div className="text-left">
            <div className="text-[10px] uppercase font-mono text-slate-400 font-semibold leading-none">{t.daysInMonthText}</div>
            <strong className="text-sm font-mono text-slate-200">{daysInMonth} Days</strong>
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
            UPS + AC + DC Power Panels
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

      <RackCapacitySummaryCard rackCapacity={rackCapacity} />

      {/* DETAILED ACCORDION BLOCKS */}
      <div className="space-y-4">
        
        {/* SECTION 1: UPS LOAD STATUS */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <button 
            type="button"
            className="w-full px-5 py-4 flex justify-between items-center bg-slate-900 hover:bg-slate-850 transition-colors text-left font-display font-bold text-slate-200 cursor-pointer text-sm"
          >
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>{t.upsSection}</span>
            </div>
            
          </button>

          {(
            <div className="p-5 border-t border-slate-850 bg-slate-950/40 space-y-6">
              
              {/* Table 1: Summary UPS */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-8 overflow-x-auto">
                  <table className="w-full text-left text-xs font-sans">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
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
                        <td className="py-3.5 px-3" colSpan={2}>Total</td>
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
                    <h4 className="text-[11px] uppercase tracking-wider font-bold text-indigo-400">UPS Loads Comparison (%)</h4>
                    <p className="text-[10px] text-slate-500">Current load capacity compared with rated maximum</p>
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
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">UMDB / UPS / AC Power Panel / STS / OUDB Detailed Configuration Mapping</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] font-sans">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider text-[9px] font-bold">
                        <th className="py-2 px-2.5">{t.no}</th>
                        <th className="py-2 px-2.5">{t.umdb}</th>
                        <th className="py-2 px-2.5">{t.upsId}</th>
                        <th className="py-2 px-2.5">{t.acPowerPanel}</th>
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
                          <td className="py-2 px-2.5 font-mono text-slate-400">{u.acPowerPanel}</td>
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
                        <td className="py-2 px-2.5" colSpan={6}>Total</td>
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

        {/* SECTION 2: AIR CONDITIONING */}
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
                <table className="w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
                      <th className="py-2.5 px-3">{t.repMonth}</th>
                      {calcs.airFields.map(field => <th key={field} className="py-2.5 px-3 text-right">{field.toUpperCase()} (GWh)</th>)}
                      <th className="py-2.5 px-3 text-right">{t.monthlyEnergy}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {/* Previous Month */}
                    <tr className="text-slate-400">
                      <td className="py-3 px-3 font-semibold text-slate-500">{calcs.prevMonthDisplay || "Previous Month"}</td>
                      {calcs.airFields.map(field => {
                        const value = prevMonthLog ? getAirValue(prevMonthLog, field) : null;
                        return <td key={field} className="py-3 px-3 text-right font-mono">{formatNumber2(value)}</td>;
                      })}
                      <td className="py-3 px-3 text-right font-mono text-slate-600">—</td>
                    </tr>
                    {/* Current Month */}
                    <tr className="text-slate-200">
                      <td className="py-3 px-3 font-semibold text-teal-400">{formatMonthYear(selectedMonth)}</td>
                      {calcs.airFields.map(field => {
                        const value = getAirValue(activeLog, field);
                        return <td key={field} className="py-3 px-3 text-right font-mono">{formatNumber2(value)}</td>;
                      })}
                      <td className="py-3 px-3 text-right font-mono text-slate-650">—</td>
                    </tr>
                    {/* Monthly Difference */}
                    <tr className="border-t-2 border-slate-800 bg-teal-950/10 font-bold text-teal-300">
                      <td className="py-3 px-3">{t.monthlyDiff}</td>
                      {calcs.airFields.map(field => {
                        const value = calcs.airDiff[field];
                        return <td key={field} className="py-3 px-3 text-right font-mono">{formatNumber2(value)}</td>;
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

        {/* SECTION 3: DC POWER PANELS */}
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
                <table className="w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
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
                      <td className="py-3.5 px-3" colSpan={2}>Total</td>
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

        {/* SECTION 4: OVERALL ENERGY & COST */}
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
                <table className="w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[10px] font-bold">
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
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* TREND INTERACTIVE SECTION */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="font-display font-semibold text-slate-100 text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>{t.trendTitle}</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              {t.trendDesc}
            </p>
          </div>

          {/* Toggle buttons for period */}
          <div className="flex p-1 bg-slate-950 rounded-xl border border-slate-850">
            {(
              [
                { id: "last3", label: t.last3 },
                { id: "last6", label: t.last6 },
                { id: "last12", label: t.last12 }
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                onClick={() => setTrendPeriod(p.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  trendPeriod === p.id 
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* One trend-line chart per parameter. Values are labelled on every
            valid month and null values remain gaps in the line. */}
        {trendDataByMetric.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-xs text-slate-500 italic">
            {lang === "th" ? "กรุณาบันทึกข้อมูลอย่างน้อยหนึ่งเดือนเพื่อแสดงกราฟแนวโน้ม" : "No logs available to generate trend charts."}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {([
              { id: "total_energy", label: t.total_energy, unit: "kWh", color: "#6366f1" },
              { id: "ups_energy", label: t.ups_energy, unit: "kWh", color: "#3b82f6" },
              { id: "air_energy", label: t.air_energy, unit: "kWh", color: "#14b8a6" },
              { id: "dc_energy", label: t.dc_energy, unit: "kWh", color: "#f59e0b" },
              { id: "floor_cost", label: t.floor_cost, unit: "THB", color: "#10b981" },
              { id: "electricity_rate", label: t.electricity_rate, unit: "THB/kWh", color: "#f97316" }
            ] as const).map(parameter => (
              <section key={parameter.id} className="trend-chart-card w-full bg-slate-950 border border-slate-850 p-6 rounded-2xl space-y-4 min-w-0 shadow-sm">
                <div className="flex justify-between items-center gap-3">
                  <div>
                    <h4 className="text-sm uppercase tracking-wide">
                      {parameter.label} Trend ({parameter.unit})
                    </h4>
                    <p className="text-xs mt-1 text-slate-400">
                      Monthly {parameter.unit === "kWh" ? "energy utilization" : "cost and rate"} pattern.
                    </p>
                  </div>
                  <span className="text-sm text-slate-400">{trendDataByMetric.length} months</span>
                </div>
                <TrendLineChart
                  labels={trendDataByMetric.map(point => point.label)}
                  unit={parameter.unit}
                  height={320}
                  series={[{ name: parameter.label, color: parameter.color, values: trendDataByMetric.map(point => point[parameter.id]) }]}
                />
              </section>
            ))}
          </div>
        )}

      </div>

    </div>
  );
}
