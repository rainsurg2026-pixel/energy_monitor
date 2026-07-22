import { Fragment, useState, useEffect } from "react";
import { UpsRecord } from "../types";
import { Save, Check, RotateCcw, AlertCircle } from "lucide-react";
import { motion } from "motion/react";
import { formatMonthYear } from "../utils";
import { EntrySectionApi } from "../utils/completion";

interface UpsTableProps {
  monthStr: string;
  initialRecords: UpsRecord[];
  lastSaved: string | null;
  onSave: (records: UpsRecord[]) => void;
  /** RC3: register imperative save/reset for the sticky toolbar. */
  registerApi?: (api: EntrySectionApi | null) => void;
  /** RC3/RC4: live draft updates for completion + validation. */
  onDraftChange?: (draft: UpsRecord[]) => void;
}

export default function UpsTable({
  monthStr,
  initialRecords,
  lastSaved,
  onSave,
  registerApi,
  onDraftChange
}: UpsTableProps) {
  const [records, setRecords] = useState<UpsRecord[]>([]);
  const [isSaved, setIsSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Sync with prop when month or initial records change
  useEffect(() => {
    setRecords(JSON.parse(JSON.stringify(initialRecords)));
    setIsSaved(false);
    setHasChanges(false);
  }, [initialRecords, monthStr]);

  const handleInputChange = (
    index: number,
    field: keyof Omit<UpsRecord, "upsId">,
    value: string
  ) => {
    setHasChanges(true);
    setIsSaved(false);
    const updated = [...records];
    
    if (value === "") {
      updated[index][field] = null;
    } else {
      const parsed = parseFloat(value);
      updated[index][field] = isNaN(parsed) ? null : parsed;
    }
    
    // Auto-calculate helper: if Voltage & Current are loaded but loadKw & loadKva are null,
    // let's suggest/autofill apparent power kVA = (1.732 * V * A) / 1000 (3-phase), and kW = kVA * 0.95 (approximate power factor)
    const record = updated[index];
    if (field === "voltage" || field === "current") {
      if (record.voltage !== null && record.current !== null) {
        const kva = (1.732 * record.voltage * record.current) / 1000;
        if (record.loadKva === null) {
          record.loadKva = Math.round(kva * 10) / 10;
        }
        if (record.loadKw === null) {
          record.loadKw = Math.round(kva * 0.95 * 10) / 10;
        }
      }
    }

    setRecords(updated);
  };

  const handlePhaseInputChange = (index: number, phase: string, field: "voltage" | "current" | "loadKw" | "loadKva", value: string) => {
    setHasChanges(true);
    setIsSaved(false);
    setRecords(previous => previous.map((record, recordIndex) => {
      if (recordIndex !== index) return record;
      const phases = { ...(record.phases ?? {}) };
      const current = { ...(phases[phase] ?? { voltage: null, current: null, loadKw: null, loadKva: null }) };
      current[field] = value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
      phases[phase] = current;
      return { ...record, phases };
    }));
  };

  // RC3: expose commit/reset to the sticky toolbar; report live drafts.
  useEffect(() => {
    registerApi?.({
      commit: () => {
        if (hasChanges) handleSaveRef.current();
      },
      reset: () => handleResetRef.current(),
      // Value-accurate (RC3): a draft equal to the stored record is not dirty.
      hasChanges: () => records.length > 0 && JSON.stringify(records) !== JSON.stringify(initialRecords)
    });
  });
  useEffect(() => {
    return () => registerApi?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    onDraftChange?.(records);
    // RC3: dirty state is value-accurate - editing back (or undoing) to the
    // initial values clears the flag again.
    if (records.length > 0 && JSON.stringify(records) === JSON.stringify(initialRecords)) {
      setHasChanges(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);
  const hasChangesRef = { current: hasChanges };
  const handleSaveRef = { current: () => handleSave() };
  const handleResetRef = { current: () => handleReset() };

  const handleSave = () => {
    onSave(records);
    setIsSaved(true);
    setHasChanges(false);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleReset = () => {
    setRecords(JSON.parse(JSON.stringify(initialRecords)));
    setHasChanges(false);
    setIsSaved(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
      {/* Table Header Section */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full" />
            <h3 className="font-display font-semibold text-slate-100 text-base">UPS Loading Records</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Input facility Uninterruptible Power Supply (UPS) voltage, current, and active/apparent loads.
          </p>
        </div>
        
        {/* Save/Reset controls */}
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
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/15"
                  : "bg-slate-800 text-slate-400 border border-slate-750"
            }`}
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaved ? "UPS Saved!" : "Save UPS"}</span>
          </button>
        </div>
      </div>

      {/* Interactive Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-indigo-950/20 text-[11px] font-mono font-semibold uppercase tracking-wider text-indigo-300 border-b border-slate-800/80">
              <th className="py-3.5 px-4 font-normal">Month</th>
              <th className="py-3.5 px-4 font-normal">UPS ID</th>
              <th className="py-3.5 px-4 font-normal text-right">Voltage (V)</th>
              <th className="py-3.5 px-4 font-normal text-right">Current (A)</th>
              <th className="py-3.5 px-4 font-normal text-right">Load (kW)</th>
              <th className="py-3.5 px-4 font-normal text-right">Load (kVA)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 font-mono text-sm text-slate-300">
            {records.map((row, idx) => {
              // Warning states
              const isVoltageAbnormal = row.voltage !== null && (row.voltage < 212 || row.voltage > 228);
              const isCurrentHigh = row.current !== null && row.current > 40;
              const phases = Object.entries(row.phases ?? {});

              return (
                <Fragment key={row.upsId}>
                <tr key={row.upsId} className="hover:bg-slate-850/40 transition-colors">
                  <td className="py-3.5 px-4 text-slate-500 text-xs">
                    {formatMonthYear(monthStr)}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-slate-200">
                    {row.upsId}
                  </td>
                  
                  {/* Aggregate values are formula-managed in Srinakarin. */}
                  <td className="py-3.5 px-2">
                    <div className="relative max-w-[120px] ml-auto">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="220"
                        value={row.voltage ?? ""}
                        onChange={(e) => handleInputChange(idx, "voltage", e.target.value)}
                        disabled={phases.length > 0}
                        className={`w-full bg-indigo-950/5 hover:bg-indigo-950/10 focus:bg-indigo-950/15 border rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all ${
                          isVoltageAbnormal 
                            ? "border-amber-600/50 text-amber-300 bg-amber-950/5 focus:border-amber-500" 
                            : "border-slate-800 focus:border-indigo-500"
                        }`}
                      />
                      {isVoltageAbnormal && (
                        <span className="absolute -left-1 top-2.5 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Current Input */}
                  <td className="py-3.5 px-2">
                    <div className="relative max-w-[120px] ml-auto">
                      <input
                        type="number"
                        step="0.1"
                        placeholder="15.0"
                        value={row.current ?? ""}
                        onChange={(e) => handleInputChange(idx, "current", e.target.value)}
                        disabled={phases.length > 0}
                        className={`w-full bg-indigo-950/5 hover:bg-indigo-950/10 focus:bg-indigo-950/15 border rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all ${
                          isCurrentHigh
                            ? "border-rose-600/50 text-rose-300 bg-rose-950/5 focus:border-rose-500"
                            : "border-slate-800 focus:border-indigo-500"
                        }`}
                      />
                    </div>
                  </td>

                  {/* Load kW Input */}
                  <td className="py-3.5 px-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="3.20"
                      value={row.loadKw ?? ""}
                      onChange={(e) => handleInputChange(idx, "loadKw", e.target.value)}
                      disabled={phases.length > 0}
                      className="w-full max-w-[120px] ml-auto bg-indigo-950/5 hover:bg-indigo-950/10 focus:bg-indigo-950/15 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                    />
                  </td>

                  {/* Load kVA Input */}
                  <td className="py-3.5 px-4">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="3.50"
                      value={row.loadKva ?? ""}
                      onChange={(e) => handleInputChange(idx, "loadKva", e.target.value)}
                      disabled={phases.length > 0}
                      className="w-full max-w-[120px] ml-auto bg-indigo-950/5 hover:bg-indigo-950/10 focus:bg-indigo-950/15 border border-slate-800 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                    />
                  </td>
                </tr>
                {phases.map(([phase, reading]) => (
                  <tr key={`${row.upsId}-${phase}`} className="bg-indigo-950/10 border-l-2 border-indigo-500/40">
                    <td className="py-2 px-4 text-slate-500 text-xs">{formatMonthYear(monthStr)}</td>
                    <td className="py-2 px-4 text-indigo-300 text-xs">{row.upsId} - {phase}</td>
                    {(["voltage", "current", "loadKw", "loadKva"] as const).map(field => (
                      <td key={field} className="py-2 px-2">
                        <input
                          type="number"
                          step={field === "voltage" || field === "current" ? "0.1" : "0.01"}
                          value={reading[field] ?? ""}
                          onChange={e => handlePhaseInputChange(idx, phase, field, e.target.value)}
                          className="w-full max-w-[120px] ml-auto bg-indigo-950/20 border border-indigo-700/50 focus:border-indigo-400 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Timestamp Label */}
      <div className="px-5 py-3 border-t border-slate-850 bg-slate-900/20 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-slate-500 font-mono">
        <span>UPS Unit Logs: {records.length} units configured</span>
        {lastSaved ? (
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            <span>Last Saved: {lastSaved}</span>
          </span>
        ) : (
          <span className="text-slate-500 italic">No entry saved for this month yet</span>
        )}
      </div>
    </div>
  );
}
