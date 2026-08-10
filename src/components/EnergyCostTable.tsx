import { useState, useEffect } from "react";
import { EnergyCostRecord } from "../types";
import { Save, Check, RotateCcw } from "lucide-react";
import { formatMonthYear } from "../utils";
import { calculateAverageElectricityRate } from "../utils/energyCost";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { EntrySectionApi } from "../utils/completion";
import NumericEntryInput from "./NumericEntryInput";

interface EnergyCostTableProps {
  monthStr: string;
  initialRecord: EnergyCostRecord;
  lastSaved: string | null;
  onSave: (record: EnergyCostRecord) => boolean | void;
  /** RC3: register imperative save/reset for the sticky toolbar. */
  registerApi?: (api: EntrySectionApi | null) => void;
  /** RC3/RC4: live draft updates for completion + validation. */
  onDraftChange?: (draft: EnergyCostRecord) => void;
}

export default function EnergyCostTable({
  monthStr,
  initialRecord,
  lastSaved,
  onSave,
  registerApi,
  onDraftChange
}: EnergyCostTableProps) {
  const [record, setRecord] = useState<EnergyCostRecord>({
    buildingEnergyKwh: null,
    buildingElectricityCostThb: null
  });
  const [isSaved, setIsSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync with prop when month or initialRecord changes
  useEffect(() => {
    setRecord({ ...initialRecord });
    setIsSaved(false);
    setHasChanges(false);
  }, [initialRecord, monthStr]);

  const handleInputChange = (field: keyof EnergyCostRecord, value: string) => {
    setHasChanges(true);
    setIsSaved(false);
    
    if (value === "") {
      setRecord(prev => ({ ...prev, [field]: null }));
    } else {
      const parsed = parseFloat(value);
      setRecord(prev => ({ ...prev, [field]: isNaN(parsed) ? null : parsed }));
    }
  };

  // RC3: expose commit/reset to the sticky toolbar; report live drafts.
  useEffect(() => {
    registerApi?.({
      commit: () => {
        if (hasChanges) handleSaveRef.current();
      },
      reset: () => handleResetRef.current(),
      // Value-accurate (RC3): a draft equal to the stored record is not dirty.
      hasChanges: () => hasChangesRef.current && JSON.stringify(record) !== JSON.stringify(initialRecord)
    });
  });
  useEffect(() => {
    return () => registerApi?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    onDraftChange?.(record);
    // RC3: dirty state is value-accurate - editing back (or undoing) to the
    // initial values clears the flag again.
    if (record && JSON.stringify(record) === JSON.stringify(initialRecord)) {
      setHasChanges(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);
  const hasChangesRef = { current: hasChanges };
  const handleSaveRef = { current: () => handleSave() };
  const handleResetRef = { current: () => handleReset() };

  const handleSave = () => {
    if (onSave(record) === false) return;
    setIsSaved(true);
    setHasChanges(false);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleReset = () => {
    setRecord({ ...initialRecord });
    setHasChanges(false);
    setIsSaved(false);
  };

  const averageRate = calculateAverageElectricityRate(
    record.buildingEnergyKwh,
    record.buildingElectricityCostThb
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
      {/* Table Header Section */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
            <h3 className="font-display font-semibold text-slate-100 text-base">Building Energy Consumption & Electricity Cost</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Input overall facility utility grid consumption metrics in Kilowatt-Hours (kWh) and billing amount in Thai Baht (THB).
            <span className="block mt-1.5 text-emerald-400/90 font-mono text-[11px] font-semibold">
              Formula: Average Electricity Rate (THB/kWh) = Building Electricity Cost (THB) / Building Energy Consumption (kWh)
            </span>
          </p>
        </div>
        
        {/* Controls */}
        <div className="flex items-center gap-3 self-end sm:self-center">
          {hasChanges && (
            <button
              onClick={handleReset}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 hover:bg-slate-800/50 rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}

          <button
            onClick={handleSave}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              isSaved
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/15"
                : hasChanges
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/15"
                  : "bg-slate-800 text-slate-400 border border-slate-750"
            }`}
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaved ? "Energy Cost Saved!" : "Save Energy Cost"}</span>
          </button>
        </div>
      </div>

      {/* Inputs Layout */}
      <div className="overflow-x-auto">
        <table className="entry-data-table w-full text-left border-collapse">
          <thead>
            <tr className="bg-emerald-950/20 text-[11px] font-mono font-semibold uppercase tracking-wider text-emerald-300 border-b border-slate-800/80">
              <th className="py-3.5 px-4 font-normal">Month</th>
              <th className="py-3.5 px-4 font-normal text-right">Building Energy Consumption (kWh)</th>
              <th className="py-3.5 px-4 font-normal text-right">Building Electricity Cost (THB)</th>
              <th className="py-3.5 px-4 font-normal text-right">Calculated Unit Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 font-mono text-sm text-slate-300">
            <tr className="hover:bg-slate-850/40 transition-colors">
              <td className="py-5 px-4 text-slate-500 text-xs font-mono">
                {formatMonthYear(monthStr)}
              </td>
              
              {/* Building Energy Kwh Input */}
              <td className="py-5 px-2">
                <NumericEntryInput
                  placeholder="45000"
                  value={record.buildingEnergyKwh}
                  onChange={value => handleInputChange("buildingEnergyKwh", value)}
                  className="w-full max-w-[220px] ml-auto bg-emerald-950/5 hover:bg-emerald-950/10 focus:bg-emerald-950/15 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                />
              </td>

              {/* Building Electricity Cost Thb Input */}
              <td className="py-5 px-2">
                <NumericEntryInput
                  placeholder="180000"
                  value={record.buildingElectricityCostThb}
                  onChange={value => handleInputChange("buildingElectricityCostThb", value)}
                  className="w-full max-w-[220px] ml-auto bg-emerald-950/5 hover:bg-emerald-950/10 focus:bg-emerald-950/15 border border-slate-800 focus:border-emerald-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                />
              </td>

              {/* Calculated Rate (THB/kWh) */}
              <td className="py-5 px-4 text-right">
                <span className={`text-xs px-2.5 py-1 rounded-md font-mono ${
                  averageRate !== null 
                    ? "bg-slate-800 text-emerald-400 font-semibold border border-slate-750" 
                    : "text-slate-600 italic"
                }`}>
                  {averageRate !== null
                    ? `${formatNumber2(averageRate)} ฿/kWh`
                    : "Enter both fields..."}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer info & timestamp */}
      <div className="px-5 py-3 border-t border-slate-850 bg-slate-900/20 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-slate-500 font-mono">
        <span>Electricity Utility Billing Records</span>
        {lastSaved ? (
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            <span>Last Saved: {lastSaved}</span>
          </span>
        ) : (
          <span className="text-slate-500 italic">No cost log saved for this month yet</span>
        )}
      </div>
    </div>
  );
}
