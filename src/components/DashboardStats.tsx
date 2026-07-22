import { MonthlyLog } from "../types";
import { calculateEnergyCostForMonth, getAirFields, getAirValue } from "../utils/energyCost";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { Zap, Thermometer, Database, Cpu } from "lucide-react";

interface DashboardStatsProps {
  log: MonthlyLog;
}

export default function DashboardStats({ log }: DashboardStatsProps) {
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

  return (
    <div className="space-y-6">
      {/* Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: UPS Total Load */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-start justify-between shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total UPS Load</p>
            <h3 className="text-2xl font-display font-semibold text-indigo-400">
              {totalUpsKw > 0 ? `${formatNumber2(totalUpsKw)} kW` : "—"}
            </h3>
            <p className="text-xs text-slate-500">
              {totalUpsKva > 0 ? `Apparent: ${formatNumber2(totalUpsKva)} kVA` : ""}
              {overallUpsPf ? ` • PF: ${formatNumber2(overallUpsPf)}` : ""}
            </p>
          </div>
          <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400">
            <Zap className="w-5 h-5" />
          </div>
        </div>

        {/* Card 2: AC Energy Consumption */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-start justify-between shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total AC Energy</p>
            <h3 className="text-2xl font-display font-semibold text-teal-400">
              {totalAirGwh === null ? "—" : `${formatNumber2(totalAirGwh)} GWh`}
            </h3>
            <p className="text-xs text-slate-500">
              {totalAirGwh === null ? "No AC logs saved" : `Equivalent: ${formatNumber2(totalAirGwh * 1000)} MWh`}
            </p>
          </div>
          <div className="p-3 bg-teal-500/10 rounded-xl text-teal-400">
            <Thermometer className="w-5 h-5" />
          </div>
        </div>

        {/* Card 3: DC Power Panel */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-start justify-between shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total DC Power</p>
            <h3 className="text-2xl font-display font-semibold text-amber-400">
              {totalDcKw > 0 ? `${formatNumber2(totalDcKw)} kW` : "—"}
            </h3>
            <p className="text-xs text-slate-500">
              {log.dc.filter(d => d.voltage !== null).length} of {log.dc.length} panels logged
            </p>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400">
            <Database className="w-5 h-5" />
          </div>
        </div>

        {/* Card 4: Building Cost Analysis */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-start justify-between shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Electricity Rate</p>
            <h3 className="text-2xl font-display font-semibold text-emerald-400">
              {costPerKwh !== null ? `${formatNumber2(costPerKwh)} ฿/kWh` : "—"}
            </h3>
            <p className="text-[10px] text-slate-500 leading-normal">
              {log.energyCost.buildingElectricityCostThb !== null
                ? `Cost: ฿${formatNumber2(log.energyCost.buildingElectricityCostThb)}`
                : "No energy cost logged"}
            </p>
            <p className="text-[9px] text-slate-500/80 font-mono leading-none">
              Rate = Cost / Consumption (kWh)
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
