import { MonthlyLog } from "../types";
import { Zap, Thermometer, Database, Cpu, TrendingUp, AlertTriangle } from "lucide-react";

interface DashboardStatsProps {
  log: MonthlyLog;
}

export default function DashboardStats({ log }: DashboardStatsProps) {
  // 1. UPS calculations
  let totalUpsKw = 0;
  let totalUpsKva = 0;
  let upsAlerts: string[] = [];

  log.ups.forEach(u => {
    if (u.loadKw !== null) totalUpsKw += u.loadKw;
    if (u.loadKva !== null) totalUpsKva += u.loadKva;
    
    // Check for abnormal voltage (safe standard range: 215V - 225V)
    if (u.voltage !== null && (u.voltage < 212 || u.voltage > 228)) {
      upsAlerts.push(`${u.upsId} voltage is abnormal: ${u.voltage}V`);
    }
  });

  const overallUpsPf = totalUpsKva > 0 ? totalUpsKw / totalUpsKva : null;

  // 2. Air Conditioning calculations
  const totalAirGwh = 
    (log.air.eb41a || 0) + 
    (log.air.eb41b || 0) + 
    (log.air.eb42a || 0) + 
    (log.air.eb42b || 0);

  // 3. DC Power calculations
  let totalDcKw = 0;
  let dcAlerts: string[] = [];

  log.dc.forEach(p => {
    if (p.voltage !== null && p.current !== null) {
      totalDcKw += (p.voltage * p.current) / 1000;
      
      // DC PDB standard 48V telecom range is typically 48V - 56V
      if (p.voltage < 46 || p.voltage > 57) {
        dcAlerts.push(`${p.panelId} voltage is abnormal: ${p.voltage}V`);
      }
    }
  });

  // 4. Energy Cost calculations
  const costPerKwh = 
    log.energyCost.buildingEnergyKwh && log.energyCost.buildingElectricityCostThb
      ? log.energyCost.buildingElectricityCostThb / log.energyCost.buildingEnergyKwh
      : null;

  const totalAlertsCount = upsAlerts.length + dcAlerts.length;

  return (
    <div className="space-y-6">
      {/* Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: UPS Total Load */}
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl flex items-start justify-between shadow-sm">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total UPS Load</p>
            <h3 className="text-2xl font-display font-semibold text-indigo-400">
              {totalUpsKw > 0 ? `${totalUpsKw.toFixed(1)} kW` : "—"}
            </h3>
            <p className="text-xs text-slate-500">
              {totalUpsKva > 0 ? `Apparent: ${totalUpsKva.toFixed(1)} kVA` : ""}
              {overallUpsPf ? ` • PF: ${overallUpsPf.toFixed(2)}` : ""}
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
              {totalAirGwh > 0 ? `${totalAirGwh.toFixed(3)} GWh` : "—"}
            </h3>
            <p className="text-xs text-slate-500">
              {totalAirGwh > 0 ? `Equivalent: ${(totalAirGwh * 1000).toFixed(0)} MWh` : "No AC logs saved"}
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
              {totalDcKw > 0 ? `${totalDcKw.toFixed(2)} kW` : "—"}
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
              {costPerKwh !== null ? `${costPerKwh.toFixed(4)} ฿/kWh` : "—"}
            </h3>
            <p className="text-[10px] text-slate-500 leading-normal">
              {log.energyCost.buildingElectricityCostThb 
                ? `Cost: ฿${log.energyCost.buildingElectricityCostThb.toLocaleString()}` 
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

      {/* Safety & Threshold Alerts */}
      {totalAlertsCount > 0 && (
        <div className="bg-amber-950/20 border border-amber-900/30 rounded-2xl p-4 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-amber-200">Facility Threshold Alerts ({totalAlertsCount})</h4>
            <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-amber-400/80">
              {upsAlerts.map((alert, idx) => (
                <div key={`ups-${idx}`} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-amber-500 rounded-full shrink-0" />
                  <span>{alert}</span>
                </div>
              ))}
              {dcAlerts.map((alert, idx) => (
                <div key={`dc-${idx}`} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-amber-500 rounded-full shrink-0" />
                  <span>{alert}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
