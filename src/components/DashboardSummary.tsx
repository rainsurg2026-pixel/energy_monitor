import React, { useState, useMemo } from "react";
import { MonthlyLog, UpsRecord, AirRecord, DcRecord } from "../types";
import { formatMonthYear } from "../utils";
import { 
  TrendingUp, 
  Zap, 
  Thermometer, 
  Database, 
  Coins, 
  Percent, 
  Calendar,
  Layers,
  ArrowRight,
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
}

type TrendPeriod = "monthly" | "quarterly" | "annual";
type TrendMetric = "total_energy" | "ups_energy" | "air_energy" | "dc_energy" | "floor_cost" | "electricity_rate";

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

export default function DashboardSummary({ logs, selectedMonth, lang, isGoogleConnected = false, googleUserEmail = null }: DashboardSummaryProps) {
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("monthly");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("total_energy");
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
      monthly: "รายเดือน",
      quarterly: "รายไตรมาส",
      annual: "รายปี",
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
      monthly: "Monthly",
      quarterly: "Quarterly",
      annual: "Annual",
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
    const getUpsRecord = (id: string) => {
      const idClean = id.replace(/\s+/g, "").toLowerCase();
      return activeLog.ups.find(u => {
        const uClean = u.upsId.replace(/\s+/g, "").toLowerCase();
        if (uClean === idClean) return true;
        if (uClean.includes("ups15a") && idClean.includes("ups15a")) return true;
        if (uClean.includes("ups15b") && idClean.includes("ups15b")) return true;
        return uClean.includes(idClean) || idClean.includes(uClean);
      }) || null;
    };

    const upsGroups = [
      {
        name: "UPS 11",
        ids: ["UPS 11A", "UPS 11B"],
        capacity: 400
      },
      {
        name: "UPS 13",
        ids: ["UPS 13A", "UPS 13B"],
        capacity: 400
      },
      {
        name: "UPS 14",
        ids: ["UPS 14C"],
        capacity: 120
      },
      {
        name: "UPS 15 (PPC44A, PPC44B)",
        ids: ["UPS 15A (PPC44A)", "UPS 15B (PPC44B)"],
        capacity: 400
      }
    ];

    const computedUpsGroups = upsGroups.map(grp => {
      let totalKw = 0;
      let totalKva = 0;
      grp.ids.forEach(id => {
        const r = getUpsRecord(id);
        if (r) {
          totalKw += r.loadKw || 0;
          totalKva += r.loadKva || 0;
        }
      });

      const loadPct = grp.capacity > 0 ? (totalKva / grp.capacity) * 100 : 0;
      const availPct = Math.max(0, 100 - loadPct);
      const monthlyEnergyKwh = totalKw * 24 * daysInMonth;

      return {
        name: grp.name,
        totalKw,
        totalKva,
        capacity: grp.capacity,
        loadPct,
        availPct,
        monthlyEnergyKwh
      };
    });

    const totalUpsKw = computedUpsGroups.reduce((acc, g) => acc + g.totalKw, 0);
    const totalUpsKva = computedUpsGroups.reduce((acc, g) => acc + g.totalKva, 0);
    const totalUpsEnergyKwh = computedUpsGroups.reduce((acc, g) => acc + g.monthlyEnergyKwh, 0);

    // Individual UPS Detail Mapping
    const upsDetailsMap = [
      { no: 1, umdb: "UMDB11A (EMDB_12A2)", upsId: "UPS 11A", sts: "STS11A", oudb: "OUDB41A", capacity: 400 },
      { no: 2, umdb: "UMDB11B (EMDB_12B2)", upsId: "UPS 11B", sts: "STS11B", oudb: "OUDB41B", capacity: 400 },
      { no: 3, umdb: "UMDB13A (EMDB_12A1)", upsId: "UPS 13A", sts: "STS13A", oudb: "OUDB42A", capacity: 400 },
      { no: 4, umdb: "UMDB13B (EMDB_12B1)", upsId: "UPS 13B", sts: "STS13B", oudb: "OUDB42B", capacity: 400 },
      { no: 5, umdb: "MTS.UPS14C (EMDB_12A-B1)", upsId: "UPS 14C", sts: "—", oudb: "OUDB43", capacity: 120 },
      { no: 6, umdb: "UMDB15A (EMDB_12A2)", upsId: "UPS 15A (PPC44A)", keyId: "UPS 15A", sts: "STS15A", oudb: "OUDB31A", capacity: 400 },
      { no: 7, umdb: "UMDB15B (EMDB_12B2)", upsId: "UPS 15B (PPC44B)", keyId: "UPS 15B", sts: "STS15B", oudb: "OUDB31B", capacity: 400 }
    ].map(item => {
      const record = getUpsRecord(item.keyId || item.upsId);
      const voltage = record?.voltage || 0;
      const current = record?.current || 0;
      const loadKw = record?.loadKw || 0;
      const loadKva = record?.loadKva || 0;
      const loadPct = item.capacity > 0 ? (loadKva / item.capacity) * 100 : 0;

      return {
        ...item,
        voltage,
        current,
        loadKw,
        loadKva,
        loadPct
      };
    });

    const detailedVoltageAvg = upsDetailsMap.reduce((acc, u) => acc + u.voltage, 0) / upsDetailsMap.length;
    const detailedCurrentSum = upsDetailsMap.reduce((acc, u) => acc + u.current, 0);

    // --- 2. AIR CONDITIONING CALCULATIONS ---
    const curAir = activeLog.air;
    const prevAir = prevMonthLog ? prevMonthLog.air : { eb41a: null, eb41b: null, eb42a: null, eb42b: null };

    const airDiff = {
      eb41a: curAir.eb41a !== null && prevAir.eb41a !== null ? Math.max(0, curAir.eb41a - prevAir.eb41a) : 0,
      eb41b: curAir.eb41b !== null && prevAir.eb41b !== null ? Math.max(0, curAir.eb41b - prevAir.eb41b) : 0,
      eb42a: curAir.eb42a !== null && prevAir.eb42a !== null ? Math.max(0, curAir.eb42a - prevAir.eb42a) : 0,
      eb42b: curAir.eb42b !== null && prevAir.eb42b !== null ? Math.max(0, curAir.eb42b - prevAir.eb42b) : 0,
    };

    const airDiffSumGwh = airDiff.eb41a + airDiff.eb41b + airDiff.eb42a + airDiff.eb42b;
    const airEnergyKwh = airDiffSumGwh * 1000000;

    // --- 3. DC POWER PANEL CALCULATIONS ---
    const computedDc = activeLog.dc.map(p => {
      const v = p.voltage || 0;
      const a = p.current || 0;
      const dcPowerW = v * a;
      const acPowerW = dcPowerW * 1.10; // 10% overhead conversion loss
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
    const totalFloorEnergyKwh = totalUpsEnergyKwh + airEnergyKwh + totalDcEnergyKwh;
    
    const buildingEnergyKwh = activeLog.energyCost.buildingEnergyKwh || 0;
    const buildingCostThb = activeLog.energyCost.buildingElectricityCostThb || 0;

    const avgElectricityRate = buildingEnergyKwh > 0 ? buildingCostThb / buildingEnergyKwh : 0;
    const estimatedFloorCostThb = totalFloorEnergyKwh * avgElectricityRate;
    const floorSharePercent = buildingEnergyKwh > 0 ? (totalFloorEnergyKwh / buildingEnergyKwh) * 100 : 0;

    return {
      computedUpsGroups,
      totalUpsKw,
      totalUpsKva,
      totalUpsEnergyKwh,
      upsDetailsMap,
      detailedVoltageAvg,
      detailedCurrentSum,
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
  }, [activeLog, prevMonthLog, daysInMonth]);

  // Historical trend parsing by period (Monthly, Quarterly, Annual)
  const aggregatedTrendData = useMemo(() => {
    // Sort chronological
    const sortedLogs = [...logs].sort((a, b) => a.month.localeCompare(b.month));

    // Calculate full metrics for each month
    const processedMonths = sortedLogs.map((log, index) => {
      // Find days
      const days = getDaysInMonth(log.month);
      
      // UPS
      const upsKwh = log.ups.reduce((acc, u) => acc + (u.loadKw || 0), 0) * 24 * days;

      // Air
      // Search previous log for this month in sorted array
      const prevLog = index > 0 ? sortedLogs[index - 1] : null;
      let airKwh = 0;
      if (prevLog) {
        const diffEb41a = Math.max(0, (log.air.eb41a || 0) - (prevLog.air.eb41a || 0));
        const diffEb41b = Math.max(0, (log.air.eb41b || 0) - (prevLog.air.eb41b || 0));
        const diffEb42a = Math.max(0, (log.air.eb42a || 0) - (prevLog.air.eb42a || 0));
        const diffEb42b = Math.max(0, (log.air.eb42b || 0) - (prevLog.air.eb42b || 0));
        airKwh = (diffEb41a + diffEb41b + diffEb42a + diffEb42b) * 1000000;
      }

      // DC
      const dcKwh = log.dc.reduce((acc, p) => {
        const v = p.voltage || 0;
        const a = p.current || 0;
        const acPowerW = v * a * 1.10;
        return acc + (acPowerW * 24 * days) / 1000;
      }, 0);

      const totalEnergy = upsKwh + airKwh + dcKwh;
      
      const bEnergy = log.energyCost.buildingEnergyKwh || 0;
      const bCost = log.energyCost.buildingElectricityCostThb || 0;
      const rate = bEnergy > 0 ? bCost / bEnergy : 0;
      const floorCost = totalEnergy * rate;

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

    if (trendPeriod === "monthly") {
      return processedMonths.map(d => ({
        label: d.monthLabel,
        value: 
          trendMetric === "total_energy" ? d.totalEnergy :
          trendMetric === "ups_energy" ? d.upsKwh :
          trendMetric === "air_energy" ? d.airKwh :
          trendMetric === "dc_energy" ? d.dcKwh :
          trendMetric === "floor_cost" ? d.floorCost :
          d.rate
      }));
    } else if (trendPeriod === "quarterly") {
      // Group by Quarter
      const quartersMap: Record<string, typeof processedMonths> = {};
      processedMonths.forEach(d => {
        if (!quartersMap[d.quarter]) quartersMap[d.quarter] = [];
        quartersMap[d.quarter].push(d);
      });

      return Object.entries(quartersMap).map(([qKey, items]) => {
        const sumTotalEnergy = items.reduce((acc, i) => acc + i.totalEnergy, 0);
        const sumUps = items.reduce((acc, i) => acc + i.upsKwh, 0);
        const sumAir = items.reduce((acc, i) => acc + i.airKwh, 0);
        const sumDc = items.reduce((acc, i) => acc + i.dcKwh, 0);
        const sumFloorCost = items.reduce((acc, i) => acc + i.floorCost, 0);
        
        const sumBEnergy = items.reduce((acc, i) => acc + i.bEnergy, 0);
        const sumBCost = items.reduce((acc, i) => acc + i.bCost, 0);
        const avgRate = sumBEnergy > 0 ? sumBCost / sumBEnergy : 0;

        return {
          label: qKey,
          value: 
            trendMetric === "total_energy" ? sumTotalEnergy :
            trendMetric === "ups_energy" ? sumUps :
            trendMetric === "air_energy" ? sumAir :
            trendMetric === "dc_energy" ? sumDc :
            trendMetric === "floor_cost" ? sumFloorCost :
            avgRate
        };
      }).sort((a, b) => a.label.localeCompare(b.label));
    } else {
      // Annual
      const yearsMap: Record<number, typeof processedMonths> = {};
      processedMonths.forEach(d => {
        if (!yearsMap[d.year]) yearsMap[d.year] = [];
        yearsMap[d.year].push(d);
      });

      return Object.entries(yearsMap).map(([yKey, items]) => {
        const sumTotalEnergy = items.reduce((acc, i) => acc + i.totalEnergy, 0);
        const sumUps = items.reduce((acc, i) => acc + i.upsKwh, 0);
        const sumAir = items.reduce((acc, i) => acc + i.airKwh, 0);
        const sumDc = items.reduce((acc, i) => acc + i.dcKwh, 0);
        const sumFloorCost = items.reduce((acc, i) => acc + i.floorCost, 0);
        
        const sumBEnergy = items.reduce((acc, i) => acc + i.bEnergy, 0);
        const sumBCost = items.reduce((acc, i) => acc + i.bCost, 0);
        const avgRate = sumBEnergy > 0 ? sumBCost / sumBEnergy : 0;

        return {
          label: yKey,
          value: 
            trendMetric === "total_energy" ? sumTotalEnergy :
            trendMetric === "ups_energy" ? sumUps :
            trendMetric === "air_energy" ? sumAir :
            trendMetric === "dc_energy" ? sumDc :
            trendMetric === "floor_cost" ? sumFloorCost :
            avgRate
        };
      }).sort((a, b) => a.label.localeCompare(b.label));
    }
  }, [logs, trendPeriod, trendMetric]);

  const maxTrendVal = useMemo(() => {
    const vals = aggregatedTrendData.map(d => d.value);
    const max = Math.max(...vals, 0);
    return max === 0 ? 100 : max * 1.15;
  }, [aggregatedTrendData]);

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
            {calcs.totalFloorEnergyKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-xs font-sans">kWh</span>
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
            ฿{calcs.estimatedFloorCostThb.toLocaleString(undefined, { maximumFractionDigits: 1 })}
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
            {calcs.floorSharePercent.toFixed(2)}%
          </h3>
          <p className="text-[10px] text-slate-400 leading-none">
            {lang === "th" ? `จากพลังงานอาคาร ${calcs.buildingEnergyKwh.toLocaleString()} kWh` : `Of total building ${calcs.buildingEnergyKwh.toLocaleString()} kWh`}
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl space-y-2">
          <p className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
            <span>{lang === "th" ? "อัตราค่าไฟเฉลี่ยอาคาร" : "Avg Electricity Rate"}</span>
          </p>
          <h3 className="text-2xl font-mono font-bold text-amber-400">
            {calcs.avgElectricityRate.toFixed(4)} <span className="text-xs font-sans">฿/kWh</span>
          </h3>
          <p className="text-[10px] text-slate-400 leading-normal">
            {lang === "th" ? `ค่าไฟอาคาร: ฿${calcs.buildingCostThb.toLocaleString()}` : `Building cost: ฿${calcs.buildingCostThb.toLocaleString()}`}
          </p>
          <p className="text-[9px] text-slate-500 font-mono leading-tight border-t border-slate-800/60 pt-1.5">
            {lang === "th" 
              ? "สูตร: อัตราค่าไฟ (บาท/kWh) = ค่าไฟฟ้าอาคาร (บาท) / การใช้พลังงานอาคาร (kWh)"
              : "Formula: Rate = Building Cost (THB) / Building Energy (kWh)"}
          </p>
        </div>
      </div>

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
                          <td className="py-3 px-3 text-right font-mono text-slate-300">{g.totalKw.toFixed(1)}</td>
                          <td className="py-3 px-3 text-right font-mono text-slate-300">{g.totalKva.toFixed(1)}</td>
                          <td className="py-3 px-3 text-right font-mono text-slate-400">{g.capacity}</td>
                          <td className="py-3 px-3 text-right font-mono text-indigo-400 font-semibold">{g.loadPct.toFixed(2)}%</td>
                          <td className="py-3 px-3 text-right font-mono text-emerald-400">{g.availPct.toFixed(2)}%</td>
                          <td className="py-3 px-3 text-right font-mono text-indigo-300">{g.monthlyEnergyKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        </tr>
                      ))}
                      {/* Total row */}
                      <tr className="border-t-2 border-slate-800 bg-slate-900/30 font-bold">
                        <td className="py-3.5 px-3" colSpan={2}>Total</td>
                        <td className="py-3.5 px-3 text-right font-mono text-slate-200">{calcs.totalUpsKw.toFixed(1)}</td>
                        <td className="py-3.5 px-3 text-right font-mono text-slate-200">{calcs.totalUpsKva.toFixed(1)}</td>
                        <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                        <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                        <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                        <td className="py-3.5 px-3 text-right font-mono text-indigo-400">{calcs.totalUpsEnergyKwh.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
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
                    {calcs.computedUpsGroups.map((g, idx) => (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex justify-between text-[11px] font-semibold text-slate-300">
                          <span>{g.name}</span>
                          <span className="font-mono text-indigo-400">{g.loadPct.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-850/50">
                          <div 
                            className={`h-full rounded-full ${g.loadPct > 80 ? "bg-rose-500" : g.loadPct > 60 ? "bg-amber-500" : "bg-indigo-500"}`}
                            style={{ width: `${Math.min(100, g.loadPct)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Table 2: Mapping Detailed UPS */}
              <div className="pt-2 border-t border-slate-850/60">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">UMDB / UPS / STS / OUDB Detailed Configuration Mapping</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] font-sans">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-500 uppercase tracking-wider text-[9px] font-bold">
                        <th className="py-2 px-2.5">{t.no}</th>
                        <th className="py-2 px-2.5">{t.umdb}</th>
                        <th className="py-2 px-2.5">{t.upsId}</th>
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
                          <td className="py-2 px-2.5 font-mono text-slate-400">{u.sts}</td>
                          <td className="py-2 px-2.5 font-mono text-slate-400">{u.oudb}</td>
                          <td className="py-2 px-2.5 text-right font-mono text-orange-200">{u.voltage}</td>
                          <td className="py-2 px-2.5 text-right font-mono text-orange-200">{u.current}</td>
                          <td className="py-2 px-2.5 text-right font-mono">{u.loadKw}</td>
                          <td className="py-2 px-2.5 text-right font-mono">{u.loadKva}</td>
                          <td className="py-2 px-2.5 text-right font-mono text-slate-500">{u.capacity}</td>
                          <td className="py-2 px-2.5 text-right font-mono text-indigo-400">{u.loadPct.toFixed(2)}%</td>
                        </tr>
                      ))}
                      {/* Detailed total row */}
                      <tr className="border-t border-slate-800 bg-slate-900/20 font-semibold text-slate-200">
                        <td className="py-2 px-2.5" colSpan={5}>Total</td>
                        <td className="py-2 px-2.5 text-right font-mono text-orange-200">{calcs.detailedVoltageAvg.toFixed(1)} (Avg)</td>
                        <td className="py-2 px-2.5 text-right font-mono text-orange-200">{calcs.detailedCurrentSum.toFixed(1)}</td>
                        <td className="py-2 px-2.5 text-right font-mono">{calcs.totalUpsKw.toFixed(1)}</td>
                        <td className="py-2 px-2.5 text-right font-mono">{calcs.totalUpsKva.toFixed(1)}</td>
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
                      <th className="py-2.5 px-3 text-right">EB41A (GWh)</th>
                      <th className="py-2.5 px-3 text-right">EB41B (GWh)</th>
                      <th className="py-2.5 px-3 text-right">EB42A (GWh)</th>
                      <th className="py-2.5 px-3 text-right">EB42B (GWh)</th>
                      <th className="py-2.5 px-3 text-right">{t.monthlyEnergy}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {/* Previous Month */}
                    <tr className="text-slate-400">
                      <td className="py-3 px-3 font-semibold text-slate-500">{calcs.prevMonthDisplay || "Previous Month"}</td>
                      <td className="py-3 px-3 text-right font-mono">{prevMonthLog?.air.eb41a !== null && prevMonthLog?.air.eb41a !== undefined ? prevMonthLog.air.eb41a.toFixed(6) : "—"}</td>
                      <td className="py-3 px-3 text-right font-mono">{prevMonthLog?.air.eb41b !== null && prevMonthLog?.air.eb41b !== undefined ? prevMonthLog.air.eb41b.toFixed(6) : "—"}</td>
                      <td className="py-3 px-3 text-right font-mono">{prevMonthLog?.air.eb42a !== null && prevMonthLog?.air.eb42a !== undefined ? prevMonthLog.air.eb42a.toFixed(6) : "—"}</td>
                      <td className="py-3 px-3 text-right font-mono">{prevMonthLog?.air.eb42b !== null && prevMonthLog?.air.eb42b !== undefined ? prevMonthLog.air.eb42b.toFixed(6) : "—"}</td>
                      <td className="py-3 px-3 text-right font-mono text-slate-600">—</td>
                    </tr>
                    {/* Current Month */}
                    <tr className="text-slate-200">
                      <td className="py-3 px-3 font-semibold text-teal-400">{formatMonthYear(selectedMonth)}</td>
                      <td className="py-3 px-3 text-right font-mono">{activeLog.air.eb41a !== null && activeLog.air.eb41a !== undefined ? activeLog.air.eb41a.toFixed(6) : "—"}</td>
                      <td className="py-3 px-3 text-right font-mono">{activeLog.air.eb41b !== null && activeLog.air.eb41b !== undefined ? activeLog.air.eb41b.toFixed(6) : "—"}</td>
                      <td className="py-3 px-3 text-right font-mono">{activeLog.air.eb42a !== null && activeLog.air.eb42a !== undefined ? activeLog.air.eb42a.toFixed(6) : "—"}</td>
                      <td className="py-3 px-3 text-right font-mono">{activeLog.air.eb42b !== null && activeLog.air.eb42b !== undefined ? activeLog.air.eb42b.toFixed(6) : "—"}</td>
                      <td className="py-3 px-3 text-right font-mono text-slate-650">—</td>
                    </tr>
                    {/* Monthly Difference */}
                    <tr className="border-t-2 border-slate-800 bg-teal-950/10 font-bold text-teal-300">
                      <td className="py-3 px-3">{t.monthlyDiff}</td>
                      <td className="py-3 px-3 text-right font-mono">{calcs.airDiff.eb41a.toFixed(6)}</td>
                      <td className="py-3 px-3 text-right font-mono">{calcs.airDiff.eb41b.toFixed(6)}</td>
                      <td className="py-3 px-3 text-right font-mono">{calcs.airDiff.eb42a.toFixed(6)}</td>
                      <td className="py-3 px-3 text-right font-mono">{calcs.airDiff.eb42b.toFixed(6)}</td>
                      <td className="py-3 px-3 text-right font-mono text-emerald-400">{calcs.airEnergyKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh</td>
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
                        <td className="py-3 px-3 text-right font-mono text-orange-200">{p.voltage.toFixed(2)}</td>
                        <td className="py-3 px-3 text-right font-mono text-orange-200">{p.current.toFixed(2)}</td>
                        <td className="py-3 px-3 text-right font-mono text-slate-300">{p.dcPowerW.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="py-3 px-3 text-right font-mono text-amber-300">{p.acCurrentA.toFixed(2)}</td>
                        <td className="py-3 px-3 text-right font-mono text-amber-200">{p.acPowerW.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="py-3 px-3 text-right font-mono text-amber-400 font-medium">{p.monthlyEnergyKwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr className="border-t-2 border-slate-800 bg-amber-950/10 font-bold">
                      <td className="py-3.5 px-3" colSpan={2}>Total</td>
                      <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                      <td className="py-3.5 px-3 text-right text-slate-500">—</td>
                      <td className="py-3.5 px-3 text-right font-mono text-slate-200">{calcs.totalDcPowerW.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-3.5 px-3 text-right font-mono text-amber-300">{calcs.totalDcAcCurrentA.toFixed(2)}</td>
                      <td className="py-3.5 px-3 text-right font-mono text-amber-200">{calcs.totalDcAcPowerW.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-3.5 px-3 text-right font-mono text-amber-400">{calcs.totalDcEnergyKwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
                      <td className="py-4 px-3 text-right font-mono text-slate-300">{calcs.buildingEnergyKwh.toLocaleString()}</td>
                      <td className="py-4 px-3 text-right font-mono text-slate-300">฿{calcs.buildingCostThb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-4 px-3 text-right font-mono text-indigo-400 font-semibold">{calcs.totalFloorEnergyKwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-4 px-3 text-right font-mono text-emerald-400 font-semibold">฿{calcs.estimatedFloorCostThb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="py-4 px-3 text-right font-mono text-amber-400 font-medium">{calcs.avgElectricityRate.toFixed(2)}</td>
                      <td className="py-4 px-3 text-right font-mono text-teal-400 font-bold">{calcs.floorSharePercent.toFixed(2)}%</td>
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
                { id: "monthly", label: t.monthly },
                { id: "quarterly", label: t.quarterly },
                { id: "annual", label: t.annual }
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

        {/* METRIC SELECTION ROW & INTERACTIVE BAR GRAPH */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <div className="lg:col-span-3 space-y-4">
            <span className="text-[10px] font-mono font-bold uppercase text-slate-400 tracking-wider">
              {t.metricLabel}
            </span>

            <div className="flex flex-col gap-2">
              {(
                [
                  { id: "total_energy", label: t.total_energy, color: "text-indigo-400 border-indigo-500/20" },
                  { id: "ups_energy", label: t.ups_energy, color: "text-blue-400 border-blue-500/20" },
                  { id: "air_energy", label: t.air_energy, color: "text-teal-400 border-teal-500/20" },
                  { id: "dc_energy", label: t.dc_energy, color: "text-amber-400 border-amber-500/20" },
                  { id: "floor_cost", label: t.floor_cost, color: "text-emerald-400 border-emerald-500/20" },
                  { id: "electricity_rate", label: t.electricity_rate, color: "text-orange-400 border-orange-500/20" }
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setTrendMetric(m.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer flex items-center justify-between ${
                    trendMetric === m.id
                      ? "bg-slate-950 text-slate-200 border-indigo-500/60 shadow"
                      : "bg-slate-900/50 text-slate-400 border-slate-850 hover:bg-slate-850"
                  }`}
                >
                  <span>{m.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 opacity-60" />
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic SVG bar chart */}
          <div className="lg:col-span-9 bg-slate-950 border border-slate-850 p-5 rounded-2xl flex flex-col justify-between">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] uppercase font-mono text-indigo-400 font-bold">
                Trend: {t[trendMetric]} ({trendPeriod})
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                Total Logs: {logs.length} months
              </span>
            </div>

            {aggregatedTrendData.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-xs text-slate-500 italic">
                {lang === "th" ? "กรุณากรอกข้อมูลในเมนูกรอกข้อมูลเพื่อเริ่มพล็อตกราฟแนวโน้ม" : "No logs available to generate trend charts."}
              </div>
            ) : (
              <div className="w-full">
                <div className="w-full overflow-x-auto">
                  <svg
                    viewBox="0 0 600 240"
                    className="w-full min-w-[500px] h-auto overflow-visible font-mono text-[9px] text-slate-400 fill-slate-400"
                  >
                    {/* Grid Lines */}
                    {[0, 1, 2, 3, 4].map((grid, idx) => {
                      const y = 30 + idx * 40;
                      const ratio = (4 - idx) / 4;
                      const val = ratio * maxTrendVal;
                      return (
                        <g key={idx}>
                          <line
                            x1="50"
                            y1={y}
                            x2="580"
                            y2={y}
                            className="stroke-slate-800/80 stroke-1"
                            strokeDasharray="2 2"
                          />
                          <text x="42" y={y + 3} textAnchor="end" className="fill-slate-500">
                            {trendMetric === "electricity_rate" 
                              ? `${val.toFixed(2)}` 
                              : trendMetric === "floor_cost" 
                              ? `฿${Math.round(val).toLocaleString()}`
                              : `${Math.round(val).toLocaleString()}`
                            }
                          </text>
                        </g>
                      );
                    })}

                    {/* Bars or Line curves depending on selection */}
                    {aggregatedTrendData.map((d, idx) => {
                      const colCount = aggregatedTrendData.length;
                      const colWidth = Math.min(45, 500 / colCount);
                      const colSpacing = (530 - colWidth * colCount) / (colCount + 1);
                      const x = 50 + colSpacing + idx * (colWidth + colSpacing);
                      
                      const barHeight = maxTrendVal > 0 ? (d.value / maxTrendVal) * 160 : 0;
                      const y = 190 - barHeight;

                      const isHighlighted = d.value > 0;

                      return (
                        <g key={idx} className="group cursor-pointer">
                          {/* Main bar background hover glow */}
                          <rect
                            x={x - 2}
                            y="25"
                            width={colWidth + 4}
                            height="170"
                            className="fill-transparent hover:fill-slate-900/10 transition-colors"
                          />

                          {/* Beautiful Gradient-like Bar */}
                          <rect
                            x={x}
                            y={y}
                            width={colWidth}
                            height={Math.max(2, barHeight)}
                            rx="4"
                            className="transition-all duration-300"
                            style={{
                              fill: 
                                trendMetric === "total_energy" ? "#6366f1" :
                                trendMetric === "ups_energy" ? "#3b82f6" :
                                trendMetric === "air_energy" ? "#14b8a6" :
                                trendMetric === "dc_energy" ? "#f59e0b" :
                                trendMetric === "floor_cost" ? "#10b981" :
                                "#f97316"
                            }}
                          />

                          {/* Data label overlay on hover */}
                          <text
                            x={x + colWidth / 2}
                            y={y - 8}
                            textAnchor="middle"
                            className="opacity-0 group-hover:opacity-100 transition-opacity fill-slate-200 font-bold text-[8px]"
                          >
                            {trendMetric === "electricity_rate" 
                              ? `${d.value.toFixed(2)}` 
                              : trendMetric === "floor_cost" 
                              ? `฿${Math.round(d.value).toLocaleString()}`
                              : `${Math.round(d.value).toLocaleString()}`
                            }
                          </text>

                          {/* X Axis labels */}
                          <text
                            x={x + colWidth / 2}
                            y="210"
                            textAnchor="middle"
                            className="fill-slate-400 font-bold group-hover:fill-indigo-400 transition-colors"
                          >
                            {d.label}
                          </text>
                        </g>
                      );
                    })}
                    {/* Bottom axis line */}
                    <line x1="50" y1="190" x2="580" y2="190" className="stroke-slate-800 stroke-1" />
                  </svg>
                </div>
              </div>
            )}
          </div>

        </div>

      </div>

    </div>
  );
}
