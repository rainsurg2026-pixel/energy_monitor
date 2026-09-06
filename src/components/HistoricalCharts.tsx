import { useMemo, useState } from "react";
import type { MonthlyLog } from "../types";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { buildMonthlyChartData } from "../utils/chartData";
import TrendLineChart from "./TrendLineChart";
import { filterLogsForDisplay } from "../utils/displayPeriod";
import { recentMonthsThroughSelected } from "../utils/historyWindow";
import { TrendingUp, Activity } from "lucide-react";

interface HistoricalChartsProps {
  logs: MonthlyLog[];
  isGoogleConnected?: boolean;
  googleUserEmail?: string | null;
  /** Optional explicit label for a non-Google authoritative source, such as
   * the authenticated Production API used by CleanWebApp. */
  dataSourceLabel?: string | null;
  lang?: "th" | "en";
  displayPeriod?: string;
  selectedMonth: string;
}

type ChartMetric = "energy" | "cost" | "subsystems";
type TrendPeriod = 3 | 6 | 12;

export default function HistoricalCharts({ logs, isGoogleConnected = false, googleUserEmail = null, dataSourceLabel = null, lang = "th", displayPeriod = "2026", selectedMonth }: HistoricalChartsProps) {
  const th = lang === "th";
  const copy = th ? {
    noData: "ยังไม่มีข้อมูลประวัติ",
    title: "สถิติและเทรนด์ประวัติการใช้พลังงาน",
    source: "แหล่งข้อมูล: Production API",
    energy: "พลังงาน",
    cost: "ค่าใช้จ่าย",
    subsystems: "UPS / แอร์ / DC",
    selectedMetric: "ตัวชี้วัดที่เลือก",
    buildingEnergy: "พลังงานอาคารและชั้น 4",
    buildingCost: "ค่าใช้จ่ายอาคารและชั้น 4",
    subsystemEnergy: "พลังงานแยกตามระบบ",
    total: "ยอดสะสมรวม",
    average: "ค่าเฉลี่ยรายเดือน",
    needTwo: "ต้องมีข้อมูลอย่างน้อย 2 เดือนที่บันทึกแล้วจึงจะแสดงเส้นแนวโน้มได้"
  } : {
    noData: "No historical records available",
    title: "Facility Trend Analytics",
    source: "Source: Production API",
    energy: "Energy",
    cost: "Cost",
    subsystems: "UPS / Air / DC",
    selectedMetric: "Selected Metric",
    buildingEnergy: "Building and 4th Floor Energy",
    buildingCost: "Building and 4th Floor Cost",
    subsystemEnergy: "Subsystem Energy",
    total: "Total Accumulation",
    average: "Monthly Average",
    needTwo: "At least 2 saved months are needed to plot historical curves."
  };
  const [activeMetric, setActiveMetric] = useState<ChartMetric>("energy");
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>(6);
  // Build each metric from the full retained history so January calculations
  // can still use a prior-year source row, then limit only the visible chart.
  const monthlyData = useMemo(() => buildMonthlyChartData(logs), [logs]);
  const visibleData = useMemo(
    () => {
      const displayMonths = monthlyData
        .filter(point => filterLogsForDisplay([{ month: point.month }], displayPeriod).length > 0)
        .map(point => point.month);
      const selectedMonths = new Set(recentMonthsThroughSelected(displayMonths, selectedMonth, trendPeriod));
      return monthlyData.filter(point => selectedMonths.has(point.month)).sort((left, right) => left.month.localeCompare(right.month));
    },
    [monthlyData, trendPeriod, displayPeriod, selectedMonth]
  );
  const selectedValues = visibleData.map(point => activeMetric === "energy" ? point.buildingEnergy : activeMetric === "cost" ? point.buildingCost : point.upsEnergy);
  const floorValues = visibleData.map(point => activeMetric === "energy" ? point.floorEnergy : activeMetric === "cost" ? point.floorCost : point.upsEnergy);
  const summarize = (values: Array<number | null>) => {
    const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
    const total = present.reduce((sum, value) => sum + value, 0);
    return { total, average: present.length > 0 ? total / present.length : null };
  };
  const buildingSummary = summarize(selectedValues);
  const floorSummary = summarize(floorValues);
  const total = buildingSummary.total;
  const average = buildingSummary.average;
  const chartSeries = activeMetric === "energy" ? [
    { name: copy.buildingEnergy, color: "#5d7fa8", values: visibleData.map(point => point.buildingEnergy) },
    { name: th ? "พลังงานชั้น 4" : "4th Floor Energy", color: "#d9776a", values: visibleData.map(point => point.floorEnergy) }
  ] : activeMetric === "cost" ? [
    { name: th ? "ค่าใช้จ่ายอาคาร" : "Building Cost", color: "#5d7fa8", values: visibleData.map(point => point.buildingCost) },
    { name: th ? "ค่าใช้จ่ายชั้น 4" : "4th Floor Cost", color: "#d9776a", values: visibleData.map(point => point.floorCost) }
  ] : [
    { name: "UPS", color: "#7c9cc8", values: visibleData.map(point => point.upsEnergy) },
    { name: th ? "ระบบปรับอากาศ" : "Air", color: "#7aa88a", values: visibleData.map(point => point.airEnergy) },
    { name: "DC", color: "#b296c7", values: visibleData.map(point => point.dcEnergy) }
  ];

  if (logs.length === 0) return <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center"><Activity className="w-10 h-10 text-slate-600 mx-auto" /><h4 className="font-medium text-slate-300 text-sm mt-2">{copy.noData}</h4></div>;
  return <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-6">
    <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
      <div><h3 className="font-semibold text-slate-100 text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-400" />{copy.title}</h3><p className="text-xs text-slate-400 mt-1">{dataSourceLabel ?? (isGoogleConnected ? `${th ? "แหล่งข้อมูลหลัก" : "Primary Source"}: Google Sheets (${googleUserEmail ?? "connected"})` : (th ? "โหมดออฟไลน์" : "Offline Mode"))}</p></div>
      <div className="flex flex-wrap gap-2 justify-end">
        <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
          {([{ id: "energy", label: copy.energy }, { id: "cost", label: copy.cost }, { id: "subsystems", label: copy.subsystems }] as const).map(tab => <button key={tab.id} onClick={() => setActiveMetric(tab.id)} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${activeMetric === tab.id ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>{tab.label}</button>)}
        </div>
        <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800" aria-label="Historical period">
          {([3, 6, 12] as const).map(period => <button key={period} onClick={() => setTrendPeriod(period)} className={`px-3 py-1.5 text-xs font-medium rounded-lg ${trendPeriod === period ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"}`}>{lang === "th" ? `ย้อนหลัง ${period} เดือน` : `Last ${period} months`}</button>)}
        </div>
      </div>
    </div>
    <div data-testid="facility-trend-summary-cards" className={`grid grid-cols-1 gap-4 border-b border-slate-800 pb-5 ${activeMetric === "subsystems" ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-5"}`}> <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl"><span className="text-[10px] uppercase tracking-wider text-slate-400">{copy.selectedMetric}</span><p className="text-xs text-slate-300 font-semibold mt-1">{activeMetric === "energy" ? (th ? "พลังงานอาคารและชั้น 4" : "Building & 4th Floor Energy") : activeMetric === "cost" ? (th ? "ค่าไฟอาคารและชั้น 4" : "Building & 4th Floor Cost") : (th ? "พลังงานระบบ UPS" : "UPS Energy")}</p></div><div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl"><span className="text-[10px] uppercase tracking-wider text-slate-400">{activeMetric === "subsystems" ? copy.total : (th ? "ยอดสะสมทั้งอาคาร" : "Building Total Accumulation")}</span><p className="text-base font-semibold text-indigo-400 font-mono mt-1">{formatNumber2(total)} {activeMetric === "cost" ? "THB" : "kWh"}</p></div>{activeMetric !== "subsystems" && <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl"><span className="text-[10px] uppercase tracking-wider text-slate-400">{th ? "ยอดสะสมชั้น 4" : "4th Floor Total Accumulation"}</span><p className="text-base font-semibold text-orange-300 font-mono mt-1">{formatNumber2(floorSummary.total)} {activeMetric === "cost" ? "THB" : "kWh"}</p></div>}<div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl"><span className="text-[10px] uppercase tracking-wider text-slate-400">{activeMetric === "subsystems" ? copy.average : (th ? "ค่าเฉลี่ยรายเดือนทั้งอาคาร" : "Building Monthly Average")}</span><p className="text-base font-semibold text-emerald-400 font-mono mt-1">{average === null ? "—" : `${formatNumber2(average)} ${activeMetric === "cost" ? "THB" : "kWh"}`}</p></div>{activeMetric !== "subsystems" && <div className="bg-slate-950/40 border border-slate-800 p-4 rounded-xl"><span className="text-[10px] uppercase tracking-wider text-slate-400">{th ? "ค่าเฉลี่ยรายเดือนชั้น 4" : "4th Floor Monthly Average"}</span><p className="text-base font-semibold text-teal-300 font-mono mt-1">{floorSummary.average === null ? "—" : `${formatNumber2(floorSummary.average)} ${activeMetric === "cost" ? "THB" : "kWh"}`}</p></div>}</div>
    {visibleData.length < 2 ? <div className="h-40 flex items-center justify-center text-xs text-slate-500 italic">{copy.needTwo}</div> : <TrendLineChart labels={visibleData.map(point => point.label)} unit={activeMetric === "cost" ? "THB" : "kWh"} series={chartSeries} />}
  </div>;
}
