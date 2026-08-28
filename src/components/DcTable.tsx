import { useState, useEffect } from "react";
import { DcRecord } from "../types";
import { Save, Check, RotateCcw } from "lucide-react";
import { formatMonthYear } from "../utils";
import { EntrySectionApi } from "../utils/completion";
import NumericEntryInput from "./NumericEntryInput";
import { formatNumber2 } from "../utils/numberFormatBridge";

interface DcTableProps {
  monthStr: string;
  initialRecords: DcRecord[];
  lastSaved: string | null;
  lang?: "th" | "en";
  onSave: (records: DcRecord[]) => void | boolean | Promise<void | boolean>;
  /** RC3: register imperative save/reset for the sticky toolbar. */
  registerApi?: (api: EntrySectionApi | null) => void;
  /** RC3/RC4: live draft updates for completion + validation. */
  onDraftChange?: (draft: DcRecord[]) => void;
}

export default function DcTable({
  monthStr,
  initialRecords,
  lastSaved,
  lang = "en",
  onSave,
  registerApi,
  onDraftChange
}: DcTableProps) {
  const th = lang === "th";
  const copy = th ? {
    title: "รายการแผงจ่ายไฟ DC",
    description: "กรอกค่าแรงดันและกระแสของแผงจ่ายไฟกระแสตรงสำหรับอุปกรณ์สำคัญ",
    reset: "รีเซ็ต",
    save: "บันทึก DC",
    saved: "บันทึก DC แล้ว",
    month: "เดือน",
    panel: "แผงจ่ายไฟ DC",
    voltage: "แรงดัน DC (V)",
    current: "กระแส DC (A)",
    calculated: "กำลังคำนวณ (kW)",
    waiting: "รอค่า V และ A…",
    panels: (count: number) => `รายการแผง DC: ${count} แผง`,
    lastSaved: "บันทึกล่าสุด",
    noSaved: "ยังไม่มีการบันทึกข้อมูล DC เดือนนี้"
  } : {
    title: "DC Power Panel Records",
    description: "Enter monthly DC voltage and current readings for each power distribution panel.",
    reset: "Reset",
    save: "Save DC Readings",
    saved: "DC Saved!",
    month: "Month",
    panel: "DC Power Panel",
    voltage: "DC Voltage (V)",
    current: "DC Current (A)",
    calculated: "CALCULATED DC POWER (kW)",
    waiting: "Waiting for V & A...",
    panels: (count: number) => `DC Panels: ${count} configured`,
    lastSaved: "Last Saved",
    noSaved: "Unsaved changes"
  };
  const [records, setRecords] = useState<DcRecord[]>([]);
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
    field: keyof Omit<DcRecord, "panelId">,
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
    
    setRecords(updated);
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

  const handleSave = async () => {
    const result = await onSave(records);
    if (result === false) return;
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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-clip shadow-sm">
      {/* Table Header Section */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-amber-500 rounded-full" />
            <h3 className="font-display font-semibold text-slate-100 text-base">{copy.title}</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {copy.description}
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
              <span>{copy.reset}</span>
            </button>
          )}

          <button
            onClick={handleSave}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              isSaved
                ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/15"
                : hasChanges
                  ? "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-600/15"
                  : "bg-slate-800 text-slate-400 border border-slate-750"
            }`}
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaved ? copy.saved : copy.save}</span>
          </button>
        </div>
      </div>

      {/* Table Container. Scrollable on mobile; clips (not scrolls) from md up so
          the sticky thead resolves against the viewport, not this wrapper. */}
      <div className="overflow-x-auto md:overflow-x-clip">
        <table className="entry-data-table w-full text-left border-collapse">
          <thead>
            <tr className="bg-amber-950/20 text-[11px] font-mono font-semibold uppercase tracking-wider text-amber-300 border-b border-slate-800/80">
              <th className="py-3.5 px-4 font-normal">{copy.month}</th>
              <th className="py-3.5 px-4 font-normal">{copy.panel}</th>
              <th className="py-3.5 px-4 font-normal text-right">{copy.voltage}</th>
              <th className="py-3.5 px-4 font-normal text-right">{copy.current}</th>
              <th className="py-3.5 px-4 font-normal normal-case text-right">{copy.calculated}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 font-mono text-sm text-slate-300">
            {records.map((row, idx) => {
              // Standard DC system standard 48V telecom has warning flags
              const isVoltageAbnormal = row.voltage !== null && (row.voltage < 46 || row.voltage > 57);
              const calculatedPowerKw = 
                row.voltage !== null && row.current !== null 
                  ? (row.voltage * row.current) / 1000 
                  : null;

              return (
                <tr key={row.panelId} className="hover:bg-slate-850/40 transition-colors">
                  <td className="py-3.5 px-4 text-slate-500 text-xs">
                    {formatMonthYear(monthStr)}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-slate-200">
                    {row.panelId}
                  </td>
                  
                  {/* DC Voltage Input */}
                  <td className="py-3.5 px-2">
                    <div className="relative max-w-[150px] ml-auto">
                      <NumericEntryInput
                        step="0.1"
                        placeholder="54.0"
                        value={row.voltage}
                        onChange={value => handleInputChange(idx, "voltage", value)}
                        className={`w-full bg-amber-950/5 hover:bg-amber-950/10 focus:bg-amber-950/15 border rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all ${
                          isVoltageAbnormal 
                            ? "border-amber-600/50 text-amber-300 bg-amber-950/5 focus:border-amber-500" 
                            : "border-slate-800 focus:border-amber-500"
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

                  {/* DC Current Input */}
                  <td className="py-3.5 px-2">
                    <NumericEntryInput
                      step="0.1"
                      placeholder="85.0"
                      value={row.current}
                      onChange={value => handleInputChange(idx, "current", value)}
                      className="w-full max-w-[150px] ml-auto bg-amber-950/5 hover:bg-amber-950/10 focus:bg-amber-950/15 border border-slate-800 focus:border-amber-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                    />
                  </td>

                  {/* Calculated Power (Display Only) */}
                  <td className="py-3.5 px-4 text-right">
                    <span className={`text-xs px-2.5 py-1 rounded-md font-mono ${
                      calculatedPowerKw !== null 
                        ? "bg-slate-800 text-amber-400 font-semibold border border-slate-750" 
                        : "text-slate-600 italic"
                    }`}>
                      {calculatedPowerKw !== null 
                        ? `${formatNumber2(calculatedPowerKw)} kW`
                        : copy.waiting}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer info & timestamp */}
      <div className="px-5 py-3 border-t border-slate-850 bg-slate-900/20 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-slate-500 font-mono">
        <span>{copy.panels(records.length)}</span>
        {lastSaved ? (
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            <span>{copy.lastSaved}: {lastSaved}</span>
          </span>
        ) : (
          <span className="text-slate-500 italic">{copy.noSaved}</span>
        )}
      </div>
    </div>
  );
}
