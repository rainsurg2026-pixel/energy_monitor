import { MonthlyLog } from "../types";
import { calculateEnergyCostForMonth, getAirFields, getAirValue } from "../utils/energyCost";
import { formatFixedNumber, formatNumber2 } from "../utils/numberFormatBridge";
import { Zap, Thermometer, Database, Cpu } from "lucide-react";

interface DashboardStatsProps {
  log: MonthlyLog;
  lang?: "th" | "en";
}

export default function DashboardStats({ log, lang = "en" }: DashboardStatsProps) {
  const th = lang === "th";
  const copy = th ? {
    ups: "โหลด UPS รวม", apparent: "กำลังปรากฏ", pf: "PF", ac: "พลังงานระบบปรับอากาศรวม",
    noAc: "ยังไม่มีการบันทึกค่าแอร์", equivalent: "เทียบเท่า", dc: "กำลังไฟ DC รวม", panels: "แผงที่บันทึกแล้ว",
    rate: "อัตราค่าไฟฟ้า", cost: "ค่าใช้จ่าย", noCost: "ยังไม่มีการบันทึกค่าไฟฟ้า", noEnergy: "ยังไม่มีการบันทึกพลังงาน", formula: "อัตรา = ค่าใช้จ่าย / ปริมาณการใช้ (kWh)"
  } : {
    ups: "Total UPS Load", apparent: "Apparent", pf: "PF", ac: "Total AC Energy",
    noAc: "No AC logs saved", equivalent: "Equivalent", dc: "Total DC Power", panels: "panels logged",
    rate: "AVERAGE UNIT RATE", cost: "Cost", noCost: "No energy cost logged", noEnergy: "No energy consumption logged", formula: "Average rate = Cost ÷ Energy"
  };
  // 1. UPS calculations
  let totalUpsKw = 0;
  let totalUpsKva = 0;

  log.ups.forEach(u => {
    if (u.loadKw !== null) totalUpsKw += u.loadKw;
    if (u.loadKva !== null) totalUpsKva += u.loadKva;
    
  });

  const overallUpsPf = totalUpsKva > 0 ? totalUpsKw / totalUpsKva : null;

  // 2. Air Conditioning calculations
  const airMeters = getAirFields(log).map(field => getAirValue(log, field));
  const totalAirGwh = airMeters.every(value => value !== null)
    ? airMeters.reduce((sum, value) => sum + (value as number), 0)
    : null;

  // 3. DC Power calculations
  let totalDcKw = 0;

  log.dc.forEach(p => {
    if (p.voltage !== null && p.current !== null) {
      totalDcKw += (p.voltage * p.current) / 1000;
      
    }
  });

  // 4. Energy Cost calculations
  const costPerKwh = calculateEnergyCostForMonth([log], log.month).averageElectricityRateThbPerKwh;
  const buildingCost = log.energyCost.buildingElectricityCostThb;
  const buildingEnergy = log.energyCost.buildingEnergyKwh;
  const hasBuildingCost = typeof buildingCost === "number" && Number.isFinite(buildingCost);
  const hasBuildingEnergy = typeof buildingEnergy === "number" && Number.isFinite(buildingEnergy);

  return (
    <div className="space-y-6">
      {/* Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: UPS Total Load */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-start justify-between shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{copy.ups}</p>
            <h3 className="text-2xl font-display font-semibold text-indigo-400">
              {totalUpsKw > 0 ? `${formatNumber2(totalUpsKw)} kW` : "—"}
            </h3>
            <p className="text-xs text-slate-500">
              {totalUpsKva > 0 ? `${copy.apparent}: ${formatNumber2(totalUpsKva)} kVA` : ""}
              {overallUpsPf ? ` • ${copy.pf}: ${formatNumber2(overallUpsPf)}` : ""}
            </p>
          </div>
          <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
            <Zap className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: AC Energy Consumption */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-start justify-between shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{copy.ac}</p>
            <h3 className="text-2xl font-display font-semibold text-teal-400">
              {totalAirGwh === null ? "—" : `${formatNumber2(totalAirGwh)} GWh`}
            </h3>
            <p className="text-xs text-slate-500">
              {totalAirGwh === null ? copy.noAc : `${copy.equivalent}: ${formatNumber2(totalAirGwh * 1000)} MWh`}
            </p>
          </div>
          <div className="p-3 bg-teal-500/10 rounded-xl text-teal-400">
            <Thermometer className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: DC Power Panel */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-start justify-between shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{copy.dc}</p>
            <h3 className="text-2xl font-display font-semibold text-amber-400">
              {totalDcKw > 0 ? `${formatNumber2(totalDcKw)} kW` : "—"}
            </h3>
            <p className="text-xs text-slate-500">
              {log.dc.filter(d => d.voltage !== null).length} / {log.dc.length} {copy.panels}
            </p>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400">
            <Database className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Building Cost Analysis */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-start justify-between shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{copy.rate}</p>
            <h3 className="text-2xl font-display font-semibold text-emerald-400">
              {costPerKwh !== null ? `${formatNumber2(costPerKwh)} ฿/kWh` : "—"}
            </h3>
            <p className="text-[10px] text-slate-500 leading-normal">
              {hasBuildingCost
                ? `${copy.cost}: ฿${formatNumber2(buildingCost)}`
                : copy.noCost}
            </p>
            <p className="text-[10px] text-slate-500 leading-normal">
              {hasBuildingEnergy
                ? `Energy: ${formatFixedNumber(buildingEnergy, 0)} kWh`
                : copy.noEnergy}
            </p>
            <p className="text-[9px] text-slate-500/80 font-mono leading-none">
              {copy.formula}
            </p>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-400">
            <Cpu className="w-5 h-5" />
          </div>
        </div>
      </div>

    </div>
  );
}
