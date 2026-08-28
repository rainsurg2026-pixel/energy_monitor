import { useState, useEffect } from "react";
import { AirRecord } from "../types";
import { Save, Check, RotateCcw } from "lucide-react";
import { formatMonthYear } from "../utils";
import { EntrySectionApi } from "../utils/completion";
import NumericEntryInput from "./NumericEntryInput";

interface AirTableProps {
  monthStr: string;
  initialRecord: AirRecord;
  lastSaved: string | null;
  lang?: "th" | "en";
  onSave: (record: AirRecord) => void | boolean | Promise<void | boolean>;
  /** RC3: register imperative save/reset for the sticky toolbar. */
  registerApi?: (api: EntrySectionApi | null) => void;
  /** RC3/RC4: live draft updates for completion + validation. */
  onDraftChange?: (draft: AirRecord) => void;
  meterFields?: string[];
  meterLabels?: Record<string, string>;
}

export default function AirTable({
  monthStr,
  initialRecord,
  lastSaved,
  lang = "en",
  onSave,
  registerApi,
  onDraftChange
  , meterFields, meterLabels
}: AirTableProps) {
  const th = lang === "th";
  const copy = th ? {
    title: "การใช้พลังงานเครื่องปรับอากาศ",
    description: "กรอกค่ามิเตอร์พลังงานเครื่องปรับอากาศเป็นกิกะวัตต์-ชั่วโมง (GWh)",
    reset: "รีเซ็ต",
    save: "บันทึก AIR",
    saved: "บันทึก AIR แล้ว",
    month: "เดือน",
    meters: (count: number) => `มิเตอร์เครื่องปรับอากาศ: ${count} จุด`,
    lastSaved: "บันทึกล่าสุด",
    noSaved: "ยังไม่มีการบันทึกข้อมูลเครื่องปรับอากาศเดือนนี้"
  } : {
    title: "Air Conditioning Energy Consumption",
    description: "Enter cumulative energy meter readings for the air-conditioning system.",
    reset: "Reset",
    save: "Save AC Readings",
    saved: "AC Saved!",
    month: "Month",
    meters: (count: number) => `AC Energy Meters: ${count} configured`,
    lastSaved: "Last Saved",
    noSaved: "Unsaved changes"
  };
  const fields = meterFields?.length ? meterFields : ["eb41a", "eb41b", "eb42a", "eb42b"];
  const label = (field: string) => meterLabels?.[field] ?? `${field.toUpperCase()} (GWh)`;
  // The original four Rangsit meters are stored directly on AirRecord. Extra
  // facility-specific meters live in `meters`, so read each field from the
  // same location that handleInputChange writes to.
  const valueForField = (field: string) =>
    ["eb41a", "eb41b", "eb42a", "eb42b"].includes(field)
      ? record[field as keyof Pick<AirRecord, "eb41a" | "eb41b" | "eb42a" | "eb42b">]
      : record.meters?.[field];
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

  const handleInputChange = (field: string, value: string) => {
    setHasChanges(true);
    setIsSaved(false);
    const parsed = value === "" ? null : parseFloat(value);
    const next = Number.isNaN(parsed) ? null : parsed;
    if (!["eb41a", "eb41b", "eb42a", "eb42b"].includes(field)) {
      setRecord(prev => ({ ...prev, meters: { ...(prev.meters ?? {}), [field]: next } }));
      return;
    }

    setRecord(prev => {
      const { meters: previousMeters, ...rest } = prev;
      const meters = { ...(previousMeters ?? {}) };
      delete meters[field];
      return { ...rest, [field]: next, ...(Object.keys(meters).length ? { meters } : {}) };
    });
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

  const handleSave = async () => {
    const result = await onSave(record);
    if (result === false) return;
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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-clip shadow-sm">
      {/* Table Header Section */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-teal-500 rounded-full" />
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
                  ? "bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-600/15"
                  : "bg-slate-800 text-slate-400 border border-slate-750"
            }`}
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaved ? copy.saved : copy.save}</span>
          </button>
        </div>
      </div>

      {/* Inputs Layout. Scrollable on mobile; clips (not scrolls) from md up so
          the sticky thead resolves against the viewport, not this wrapper. */}
      <div className="overflow-x-auto md:overflow-x-clip">
        <table className="entry-data-table w-full text-left border-collapse">
          <thead>
            <tr className="bg-teal-950/20 text-[11px] font-mono font-semibold uppercase tracking-wider text-teal-300 border-b border-slate-800/80">
              <th className="py-3.5 px-4 font-normal">{copy.month}</th>
              {fields.map(field => <th key={field} className="py-3.5 px-4 font-normal text-right">{label(field)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50 font-mono text-sm text-slate-300">
            <tr className="hover:bg-slate-850/40 transition-colors">
              <td className="py-5 px-4 text-slate-500 text-xs font-mono">
                {formatMonthYear(monthStr)}
              </td>
              
              {fields.map(field => (
                <td key={field} className="py-5 px-2">
                  <NumericEntryInput
                    ariaLabel={label(field)}
                    step="0.000001"
                    precision={6}
                    placeholder="0.000000"
                    value={valueForField(field)}
                    onChange={value => {
                      handleInputChange(field, value);
                    }}
                    className="w-full max-w-[150px] ml-auto bg-teal-950/5 hover:bg-teal-950/10 focus:bg-teal-950/15 border border-slate-800 focus:border-teal-500 rounded-lg px-3 py-1.5 text-right font-mono text-sm focus:outline-none transition-all"
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Footer info & timestamp */}
      <div className="px-5 py-3 border-t border-slate-850 bg-slate-900/20 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-slate-500 font-mono">
        <span>{copy.meters(fields.length)}</span>
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
