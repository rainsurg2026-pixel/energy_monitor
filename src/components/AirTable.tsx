import { useState, useEffect } from "react";
import { AirRecord } from "../types";
import { Save, Check, RotateCcw } from "lucide-react";
import { formatMonthYear } from "../utils";
import { EntrySectionApi } from "../utils/completion";

interface AirTableProps {
  monthStr: string;
  initialRecord: AirRecord;
  lastSaved: string | null;
  onSave: (record: AirRecord) => void;
  /** RC3: register imperative save/reset for the sticky toolbar. */
  registerApi?: (api: EntrySectionApi | null) => void;
  /** RC3/RC4: live draft updates for completion + validation. */
  onDraftChange?: (draft: AirRecord) => void;
}

export default function AirTable({
  monthStr,
  initialRecord,
  lastSaved,
  onSave,
  registerApi,
  onDraftChange
}: AirTableProps) {
  const [record, setRecord] = useState<AirRecord>({
    eb41a: null,
    eb41b: null,
    eb42a: null,
    eb42b: null
  });
  const [isSaved, setIsSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync with prop when month or initialRecord changes
  useEffect(() => {
    setRecord({ ...initialRecord });
    setIsSaved(false);
    setHasChanges(false);
  }, [initialRecord, monthStr]);

  const handleInputChange = (field: keyof AirRecord, value: string) => {
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
      hasChanges: () => hasChangesRef.current
    });
  });
  useEffect(() => {
    return () => registerApi?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    onDraftChange?.(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);
  const hasChangesRef = { current: hasChanges };
  const handleSaveRef = { current: () => handleSave() };
  const handleResetRef = { current: () => handleReset() };

  const handleSave = () => {
    onSave(record);
    setIsSaved(true);
    setHasChanges(false);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleReset = () => {
    setRecord({ ...initialRecord });
    setHasChanges(false);
    setIsSaved(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
      {/* Table Header Section */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-teal-500 rounded-full" />
            <h3 className="font-display font-semibold text-slate-100 text-base">Air Conditioning Energy Consumption</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Input Giga-Watt Hour (GWh) readings of air conditioning modules for temperature and humidity control.
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
                  ? "bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/15"
                  : "bg-slate-800 text-slate-400 border border-slate-750"
            }`}
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaved ? "AIR Saved!" : "Save AIR"}</span>
          </button>
        </div>
      </div>

      {/* Inputs Layout */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-teal-950/20 text-[11px] font-mono font-semibold uppercase tracking-wider text-teal-300 border-b border-slate-800/80">
              <th className="py-3.5 px-4 font-normal">Month</th>
              <th className="py-3.5 px-4 font-normal text-right">EB41A (GWh)</th>
              <th className="py-3.5 px-4 font-normal text-right">EB41B (GWh)</th>
              <th className="py-3.5 px-4 font-normal text-right">EB42A (GWh)</th>
              <th className="py-3.5 px-4 font-normal text-right">EB42B (GWh)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 font-mono text-sm text-slate-300">
            <tr className="hover:bg-slate-850/40 transition-colors">
              <td className="py-5 px-4 text-slate-500 text-xs font-mono">
                {formatMonthYear(monthStr)}
              </td>
              
              {/* EB41A GWh Input */}
              <td className="py-5 px-2">
                <input
                  type="number"
                  step="0.0001"
                  placeholder="1.2500"
                  value={record.eb41a ?? ""}
                  onChange={(e) => handleInputChange("eb41a", e.target.value)}
                  className="w-full max-w-[150px] ml-auto bg-teal-950/5 hover:bg-teal-950/10 focus:bg-teal-950/15 border border-slate-800 focus:border-teal-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                />
              </td>

              {/* EB41B GWh Input */}
              <td className="py-5 px-2">
                <input
                  type="number"
                  step="0.0001"
                  placeholder="0.9500"
                  value={record.eb41b ?? ""}
                  onChange={(e) => handleInputChange("eb41b", e.target.value)}
                  className="w-full max-w-[150px] ml-auto bg-teal-950/5 hover:bg-teal-950/10 focus:bg-teal-950/15 border border-slate-800 focus:border-teal-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                />
              </td>

              {/* EB42A GWh Input */}
              <td className="py-5 px-2">
                <input
                  type="number"
                  step="0.0001"
                  placeholder="1.4500"
                  value={record.eb42a ?? ""}
                  onChange={(e) => handleInputChange("eb42a", e.target.value)}
                  className="w-full max-w-[150px] ml-auto bg-teal-950/5 hover:bg-teal-950/10 focus:bg-teal-950/15 border border-slate-800 focus:border-teal-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                />
              </td>

              {/* EB42B GWh Input */}
              <td className="py-5 px-4">
                <input
                  type="number"
                  step="0.0001"
                  placeholder="1.1500"
                  value={record.eb42b ?? ""}
                  onChange={(e) => handleInputChange("eb42b", e.target.value)}
                  className="w-full max-w-[150px] ml-auto bg-teal-950/5 hover:bg-teal-950/10 focus:bg-teal-950/15 border border-slate-800 focus:border-teal-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer info & timestamp */}
      <div className="px-5 py-3 border-t border-slate-850 bg-slate-900/20 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-slate-500 font-mono">
        <span>Combined Air-Con Consumption Units: 4 meters</span>
        {lastSaved ? (
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            <span>Last Saved: {lastSaved}</span>
          </span>
        ) : (
          <span className="text-slate-500 italic">No AC log saved for this month yet</span>
        )}
      </div>
    </div>
  );
}
