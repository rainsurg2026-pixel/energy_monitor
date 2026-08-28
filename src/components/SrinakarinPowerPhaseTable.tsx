import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import type { MonthlyLog, PhaseReading, SrinakarinInputSnapshot, UpsRecord } from "../types";
import { formatMonthYear } from "../utils";
import { EntrySectionApi } from "../utils/completion";
import { formatFixedNumber } from "../utils/numberFormatBridge";
import NumericEntryInput from "./NumericEntryInput";
import {
  calculateSrinakarinAggregate,
  cloneSrinakarinInputs,
  SRINAKARIN_DEFAULT_AC_PHASE_IDS,
  SRINAKARIN_DEFAULT_PPC43_CURRENT_IDS,
  SRINAKARIN_DEFAULT_PPC43_PANEL_IDS,
  SRINAKARIN_DEFAULT_UPS_PHASE_IDS
} from "../utils/srinakarinPower";

interface SrinakarinPowerPhaseTableProps {
  monthStr: string;
  initialLog: MonthlyLog;
  lastSaved: string | null;
  lang?: "th" | "en";
  onSave: (records: UpsRecord[], inputs: SrinakarinInputSnapshot) => void | boolean | Promise<void | boolean>;
  registerApi?: (api: EntrySectionApi | null) => void;
  onDraftChange?: (draft: UpsRecord[], inputs: SrinakarinInputSnapshot) => void;
}

const PHASES = ["R", "S", "T"] as const;
const PPC_MANUAL_LOAD_IDS = ["PPC 41A", "PPC 41B", "PPC 42A", "PPC 42B", "PPC 44A", "PPC 44B"];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptyPhase(): PhaseReading {
  return { voltage: null, current: null, loadKw: null, loadKva: null };
}

function withPhaseDefaults(input: SrinakarinInputSnapshot, initialLog: MonthlyLog): SrinakarinInputSnapshot {
  const next = clone(input);
  const existingUps = Object.keys(next.upsPhase);
  const upsIds = existingUps.length > 0
    ? existingUps
    : SRINAKARIN_DEFAULT_UPS_PHASE_IDS.flatMap(id => PHASES.map(phase => `${id} - ${phase}`));
  for (const id of upsIds) {
    if (!next.upsPhase[id]) {
      const base = initialLog.ups.find(record => record.upsId === id.replace(/\s+-\s+[RST]$/i, ""));
      next.upsPhase[id] = {
        voltage: base?.voltage ?? null,
        current: base?.current ?? null,
        loadKw: base?.loadKw ?? null,
        loadKva: base?.loadKva ?? null
      };
    }
  }

  const existingAc = Object.keys(next.acPhase);
  const acIds = existingAc.length > 0
    ? existingAc
    : SRINAKARIN_DEFAULT_AC_PHASE_IDS.flatMap(id => PHASES.map(phase => `${id} - ${phase}`));
  for (const id of acIds) next.acPhase[id] ??= { voltage: null, current: null };

  for (const id of SRINAKARIN_DEFAULT_PPC43_CURRENT_IDS) next.ppc43Current[id] ??= null;
  for (const id of SRINAKARIN_DEFAULT_PPC43_PANEL_IDS) next.ppc43Panel[id] ??= { loadKw: null, loadKva: null };
  return next;
}

function inputNumber(value: string): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inputClass(readOnly = false): string {
  return `w-full min-w-[92px] rounded-lg border px-2.5 py-1.5 text-right font-mono text-sm outline-none transition-colors ${
    readOnly
      ? "border-slate-800 bg-slate-950/60 text-slate-500"
      : "border-slate-700 bg-slate-950/30 text-slate-200 focus:border-teal-400"
  }`;
}

export default function SrinakarinPowerPhaseTable({
  monthStr,
  initialLog,
  lastSaved,
  lang = "en",
  onSave,
  registerApi,
  onDraftChange
}: SrinakarinPowerPhaseTableProps) {
  const th = lang === "th";
  const copy = th ? {
    title: "ข้อมูลเฟส UPS และ PPC ของศรีนครินทร์",
    description: "กรอกข้อมูล R/S/T ตามลำดับการทำงานของ Excel · PPC44 กรอก Voltage/Current/Load เองทั้งหมด",
    month: "เดือน",
    ups: "UPS",
    acPanel: "แผงไฟ AC",
    upsPpc: "UPS และ PPC",
    voltage: "แรงดัน (V)",
    current: "กระแส (A)",
    loadKw: "โหลด (kW)",
    loadKva: "โหลด (kVA)",
    reset: "รีเซ็ต",
    save: "บันทึก UPS/PPC",
    saved: "บันทึกแล้ว",
    lastSaved: "บันทึกล่าสุด",
    noSaved: "ยังไม่มีการบันทึกข้อมูลเดือนนี้",
    upsPhase: "1. โหลด UPS รายเฟส",
    upsPhaseDescription: "แหล่งข้อมูล: 1.1 UPS Data Log By Phase ผลรวมรายเดือนจะถูกเฉลี่ยไปยัง 1. UPS Data Log",
    ppcPhase: "2. แรงดันและกระแส PPC รายเฟส",
    manualLoad: "3. โหลดรวม PPC แบบกรอกเอง",
    ppcCurrent: "4. กระแสแผง PPC43",
    ppcLoad: "5. โหลดแผง PPC43",
    preview: "6. ตัวอย่างผลรวมรายเดือน"
  } : {
    title: "Srinakarin UPS & PPC Phase Input",
    description: "Enter monthly UPS voltage, current, active power, and apparent power readings.",
    month: "Month",
    ups: "UPS",
    acPanel: "AC Power Panel",
    upsPpc: "UPS & PPC",
    voltage: "Voltage (V)",
    current: "Current (A)",
    loadKw: "Load (kW)",
    loadKva: "Load (kVA)",
    reset: "Reset",
    save: "Save UPS Readings",
    saved: "UPS Saved!",
    lastSaved: "Last Saved",
    noSaved: "Unsaved changes",
    upsPhase: "1. UPS Phase Load",
    upsPhaseDescription: "Input source: 1.1 UPS Data Log By Phase. Monthly output is averaged into 1. UPS Data Log.",
    ppcPhase: "2. PPC Phase Voltage & Current",
    manualLoad: "3. Manual PPC Aggregate Load",
    ppcCurrent: "4. PPC43 Panel Current",
    ppcLoad: "5. PPC43 Panel Load",
    preview: "6. Monthly Aggregate Preview"
  };
  const [inputs, setInputs] = useState<SrinakarinInputSnapshot>(() => withPhaseDefaults(cloneSrinakarinInputs(initialLog.srinakarinInputs), initialLog));
  const [manualLoads, setManualLoads] = useState<Record<string, { loadKw: number | null; loadKva: number | null }>>(() => {
    const rows: Record<string, { loadKw: number | null; loadKva: number | null }> = {};
    for (const id of PPC_MANUAL_LOAD_IDS) {
      const record = initialLog.ups.find(item => item.upsId === id);
      rows[id] = { loadKw: record?.loadKw ?? null, loadKva: record?.loadKva ?? null };
    }
    return rows;
  });
  const [isSaved, setIsSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setInputs(withPhaseDefaults(cloneSrinakarinInputs(initialLog.srinakarinInputs), initialLog));
    const rows: Record<string, { loadKw: number | null; loadKva: number | null }> = {};
    for (const id of PPC_MANUAL_LOAD_IDS) {
      const record = initialLog.ups.find(item => item.upsId === id);
      rows[id] = { loadKw: record?.loadKw ?? null, loadKva: record?.loadKva ?? null };
    }
    setManualLoads(rows);
    setHasChanges(false);
    setIsSaved(false);
  }, [initialLog, monthStr]);

  const draftRecords = useMemo(() => {
    const aggregate = calculateSrinakarinAggregate({
      ...initialLog,
      ups: initialLog.ups.map(record => ({ ...record, ...(manualLoads[record.upsId] ?? {}) })),
      srinakarinInputs: inputs
    });
    return aggregate.map(record => ({
      ...record,
      ...(manualLoads[record.upsId] ? manualLoads[record.upsId] : {})
    }));
  }, [initialLog, inputs, manualLoads]);

  useEffect(() => {
    onDraftChange?.(draftRecords, clone(inputs));
  }, [draftRecords, inputs, onDraftChange]);

  const updateUpsPhase = (id: string, field: keyof PhaseReading, value: string) => {
    setHasChanges(true);
    setIsSaved(false);
    setInputs(previous => ({
      ...previous,
      upsPhase: {
        ...previous.upsPhase,
        [id]: { ...(previous.upsPhase[id] ?? emptyPhase()), [field]: inputNumber(value) }
      }
    }));
  };

  const updateAcPhase = (id: string, field: "voltage" | "current", value: string) => {
    setHasChanges(true);
    setIsSaved(false);
    setInputs(previous => ({
      ...previous,
      acPhase: {
        ...previous.acPhase,
        [id]: { ...(previous.acPhase[id] ?? { voltage: null, current: null }), [field]: inputNumber(value) }
      }
    }));
  };

  const updatePpc43Current = (id: string, value: string) => {
    setHasChanges(true);
    setIsSaved(false);
    setInputs(previous => ({ ...previous, ppc43Current: { ...previous.ppc43Current, [id]: inputNumber(value) } }));
  };

  const updatePpc43Panel = (id: string, field: "loadKw" | "loadKva", value: string) => {
    setHasChanges(true);
    setIsSaved(false);
    setInputs(previous => ({
      ...previous,
      ppc43Panel: {
        ...previous.ppc43Panel,
        [id]: { ...(previous.ppc43Panel[id] ?? { loadKw: null, loadKva: null }), [field]: inputNumber(value) }
      }
    }));
  };

  const updateManualLoad = (id: string, field: "loadKw" | "loadKva", value: string) => {
    setHasChanges(true);
    setIsSaved(false);
    setManualLoads(previous => ({ ...previous, [id]: { ...(previous[id] ?? { loadKw: null, loadKva: null }), [field]: inputNumber(value) } }));
  };

  const handleSave = async () => {
    const result = await onSave(draftRecords, clone(inputs));
    if (result === false) return;
    setIsSaved(true);
    setHasChanges(false);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleReset = () => {
    setInputs(withPhaseDefaults(cloneSrinakarinInputs(initialLog.srinakarinInputs), initialLog));
    const rows: Record<string, { loadKw: number | null; loadKva: number | null }> = {};
    for (const id of PPC_MANUAL_LOAD_IDS) {
      const record = initialLog.ups.find(item => item.upsId === id);
      rows[id] = { loadKw: record?.loadKw ?? null, loadKva: record?.loadKva ?? null };
    }
    setManualLoads(rows);
    setHasChanges(false);
    setIsSaved(false);
  };

  const handleSaveRef = { current: handleSave };
  const handleResetRef = { current: handleReset };
  const hasChangesRef = { current: hasChanges };
  useEffect(() => {
    registerApi?.({
      commit: () => { if (hasChangesRef.current) handleSaveRef.current(); },
      reset: () => handleResetRef.current(),
      hasChanges: () => hasChangesRef.current
    });
  });
  useEffect(() => () => registerApi?.(null), [registerApi]);

  const upsRows = Object.entries(inputs.upsPhase).sort(([a], [b]) => a.localeCompare(b));
  const acRows = Object.entries(inputs.acPhase) as Array<[string, { voltage: number | null; current: number | null }]>;
  acRows.sort(([a], [b]) => a.localeCompare(b));
  const ppc43CurrentRows = Object.entries(inputs.ppc43Current) as Array<[string, number | null]>;
  ppc43CurrentRows.sort(([a], [b]) => a.localeCompare(b));
  const ppc43PanelRows = Object.entries(inputs.ppc43Panel).sort(([a], [b]) => a.localeCompare(b));
  const isPpc43 = (id: string) => id.toLowerCase().includes("ppc 43");

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-clip shadow-sm space-y-0">
      <div className="p-5 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-slate-900/60">
        <div>
          <h3 className="font-display font-semibold text-slate-100 text-base">{copy.title}</h3>
          <p className="text-xs text-slate-400 mt-1">{copy.description}</p>
          <p className="text-xs text-slate-500 mt-1">{th ? "เดือนรายงาน" : "Reporting Month"}: <span className="text-slate-300">{formatMonthYear(monthStr)}</span></p>
        </div>
        <div className="flex items-center gap-3 self-end lg:self-center">
          {hasChanges && <button type="button" onClick={handleReset} className="px-3 py-1.5 text-xs text-slate-400 border border-slate-700 rounded-lg flex items-center gap-1.5"><RotateCcw className="w-3.5 h-3.5" />{copy.reset}</button>}
          <button type="button" onClick={handleSave} className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${isSaved ? "bg-emerald-600 text-white" : hasChanges ? "bg-teal-600 text-white" : "bg-slate-800 text-slate-400 border border-slate-700"}`}>
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}{isSaved ? copy.saved : copy.save}
          </button>
        </div>
      </div>

      <section className="p-5 border-b border-slate-800">
        <h4 className="text-sm text-slate-100">{copy.upsPhase}</h4>
        <p className="text-xs text-slate-500 mt-1 mb-4">{copy.upsPhaseDescription}</p>
        <div className="overflow-x-auto md:overflow-x-clip"><table className="entry-data-table md:min-w-0 w-full min-w-[900px] text-left border-collapse"><thead><tr className="bg-indigo-950/30 text-[11px] font-normal uppercase tracking-wider text-indigo-300 border-b border-slate-800/80"><th className="py-2 px-3">{copy.month}</th><th className="py-2 px-3">{copy.ups}</th><th className="py-2 px-3 text-right">{copy.voltage}</th><th className="py-2 px-3 text-right">{copy.current}</th><th className="py-2 px-3 text-right">{copy.loadKw}</th><th className="py-2 px-3 text-right">{copy.loadKva}</th></tr></thead><tbody className="divide-y divide-slate-800/70">{upsRows.map(([id, row]) => <tr key={id} className="hover:bg-slate-850/40 transition-colors"><td className="py-2 px-3 text-xs text-slate-500">{formatMonthYear(monthStr)}</td><td className="py-2 px-3 text-sm text-slate-200">{id}</td>{(["voltage", "current", "loadKw", "loadKva"] as const).map(field => <td key={field} className="py-2 px-2"><NumericEntryInput step="0.1" precision={1} value={row[field]} onChange={value => updateUpsPhase(id, field, value)} ariaLabel={`${id} ${field}`} className={inputClass()} /></td>)}</tr>)}</tbody></table></div>
      </section>

      <section className="p-5 border-b border-slate-800">
        <h4 className="text-sm text-slate-100">{copy.ppcPhase}</h4>
        <p className="text-xs text-slate-500 mt-1 mb-4">PPC41, PPC42 และ PPC44 กรอกเองทั้งหมด · PPC43 Current แสดงผลจาก 1.6 แบบ Read-only</p>
        <div className="overflow-x-auto md:overflow-x-clip"><table className="entry-data-table md:min-w-0 w-full min-w-[760px] text-left border-collapse"><thead><tr className="bg-teal-950/30 text-[11px] font-normal uppercase tracking-wider text-teal-300 border-b border-slate-800/80"><th className="py-2 px-3">{copy.month}</th><th className="py-2 px-3">{copy.acPanel}</th><th className="py-2 px-3 text-right">{copy.voltage}</th><th className="py-2 px-3 text-right">{copy.current}</th></tr></thead><tbody className="divide-y divide-slate-800/70">{acRows.map(([id, row]) => <tr key={id} className="hover:bg-slate-850/40 transition-colors"><td className="py-2 px-3 text-xs text-slate-500">{formatMonthYear(monthStr)}</td><td className="py-2 px-3 text-sm text-slate-200">{id}</td><td className="py-2 px-2"><NumericEntryInput step="0.1" value={row.voltage} onChange={value => updateAcPhase(id, "voltage", value)} ariaLabel={`${id} voltage`} className={inputClass()} /></td><td className="py-2 px-2"><NumericEntryInput step="0.1" value={row.current} onChange={value => updateAcPhase(id, "current", value)} disabled={isPpc43(id)} ariaLabel={`${id} current`} className={inputClass(isPpc43(id))} /></td></tr>)}</tbody></table></div>
      </section>

      <section className="p-5 border-b border-slate-800">
        <h4 className="text-sm text-slate-100">{copy.manualLoad}</h4>
        <p className="text-xs text-slate-500 mt-1 mb-4">{th ? "PPC41, PPC42 และ PPC44: โหลดรวม kW/kVA" : "PPC41, PPC42 and PPC44 Load kW/kVA"}</p>
        <div className="overflow-x-auto md:overflow-x-clip"><table className="entry-data-table md:min-w-0 w-full min-w-[620px] text-left border-collapse"><thead><tr className="bg-amber-950/20 text-[11px] font-normal uppercase tracking-wider text-amber-300 border-b border-slate-800/80"><th className="py-2 px-3">{copy.month}</th><th className="py-2 px-3">{copy.acPanel}</th><th className="py-2 px-3 text-right">{copy.loadKw}</th><th className="py-2 px-3 text-right">{copy.loadKva}</th></tr></thead><tbody className="divide-y divide-slate-800/70">{PPC_MANUAL_LOAD_IDS.map(id => <tr key={id} className="hover:bg-slate-850/40 transition-colors"><td className="py-2 px-3 text-xs text-slate-500">{formatMonthYear(monthStr)}</td><td className="py-2 px-3 text-sm text-slate-200">{id}</td><td className="py-2 px-2"><NumericEntryInput step="0.1" precision={1} value={manualLoads[id]?.loadKw} onChange={value => updateManualLoad(id, "loadKw", value)} ariaLabel={`${id} load kW`} className={inputClass()} /></td><td className="py-2 px-2"><NumericEntryInput step="0.1" precision={1} value={manualLoads[id]?.loadKva} onChange={value => updateManualLoad(id, "loadKva", value)} ariaLabel={`${id} load kVA`} className={inputClass()} /></td></tr>)}</tbody></table></div>
      </section>

      <section className="p-5 border-b border-slate-800">
        <h4 className="text-sm text-slate-100">{copy.ppcCurrent}</h4>
        <p className="text-xs text-slate-500 mt-1 mb-4">{th ? "แหล่งข้อมูล: 1.6 AC PPC43 (A) · 1.4.1 จะรวมค่าด้วย SUMIFS" : "Input source: 1.6 AC PPC43 (A) · 1.4.1 aggregates these values with SUMIFS"}</p>
        <div className="overflow-x-auto md:overflow-x-clip"><table className="entry-data-table md:min-w-0 w-full min-w-[620px] text-left border-collapse"><thead><tr className="bg-sky-950/20 text-[11px] font-normal uppercase tracking-wider text-sky-300 border-b border-slate-800/80"><th className="py-2 px-3">{copy.month}</th><th className="py-2 px-3">{copy.acPanel}</th><th className="py-2 px-3 text-right">{copy.current}</th></tr></thead><tbody className="divide-y divide-slate-800/70">{ppc43CurrentRows.map(([id, value]) => <tr key={id} className="hover:bg-slate-850/40 transition-colors"><td className="py-2 px-3 text-xs text-slate-500">{formatMonthYear(monthStr)}</td><td className="py-2 px-3 text-sm text-slate-200">{id}</td><td className="py-2 px-2"><NumericEntryInput step="0.1" value={value} onChange={next => updatePpc43Current(id, next)} ariaLabel={`${id} current`} className={inputClass()} /></td></tr>)}</tbody></table></div>
      </section>

      <section className="p-5 border-b border-slate-800">
        <h4 className="text-sm text-slate-100">{copy.ppcLoad}</h4>
        <p className="text-xs text-slate-500 mt-1 mb-4">{th ? "แหล่งข้อมูล: 1.7 AC PPC43 Panel (A)" : "Input source: 1.7 AC PPC43 Panel (A)"}</p>
        <div className="overflow-x-auto md:overflow-x-clip"><table className="entry-data-table md:min-w-0 w-full min-w-[720px] text-left border-collapse"><thead><tr className="bg-violet-950/20 text-[11px] font-normal uppercase tracking-wider text-violet-300 border-b border-slate-800/80"><th className="py-2 px-3">{copy.month}</th><th className="py-2 px-3">{copy.acPanel}</th><th className="py-2 px-3 text-right">{copy.loadKw}</th><th className="py-2 px-3 text-right">{copy.loadKva}</th></tr></thead><tbody className="divide-y divide-slate-800/70">{ppc43PanelRows.map(([id, row]) => <tr key={id} className="hover:bg-slate-850/40 transition-colors"><td className="py-2 px-3 text-xs text-slate-500">{formatMonthYear(monthStr)}</td><td className="py-2 px-3 text-sm text-slate-200">{id}</td>{(["loadKw", "loadKva"] as const).map(field => <td key={field} className="py-2 px-2"><NumericEntryInput step="0.1" precision={1} value={row[field]} onChange={value => updatePpc43Panel(id, field, value)} ariaLabel={`${id} ${field}`} className={inputClass()} /></td>)}</tr>)}</tbody></table></div>
      </section>

      <section className="p-5">
        <h4 className="text-sm text-slate-100">{copy.preview}</h4>
        <p className="text-xs text-slate-500 mt-1 mb-4">{th ? "ผลลัพธ์จะถูกบันทึกลง `1. UPS Data Log` โดยใช้เดือนและรหัสอุปกรณ์เป็นตัวจับคู่" : "Results are stored in `1. UPS Data Log` using Month + Device ID as the matching key."}</p>
        <div className="overflow-x-auto md:overflow-x-clip"><table className="entry-data-table md:min-w-0 w-full min-w-[900px] text-left border-collapse"><thead><tr className="bg-slate-950/60 text-[11px] font-normal uppercase tracking-wider text-slate-400 border-b border-slate-800/80"><th className="py-2 px-3">{copy.month}</th><th className="py-2 px-3">{copy.upsPpc}</th><th className="py-2 px-3 text-right">{copy.voltage}</th><th className="py-2 px-3 text-right">{copy.current}</th><th className="py-2 px-3 text-right">{copy.loadKw}</th><th className="py-2 px-3 text-right">{copy.loadKva}</th></tr></thead><tbody className="divide-y divide-slate-800/70">{draftRecords.map(row => <tr key={row.upsId} className="hover:bg-slate-850/40 transition-colors"><td className="py-2 px-3 text-xs text-slate-500">{formatMonthYear(monthStr)}</td><td className="py-2 px-3 text-sm text-slate-200">{row.upsId}</td><td className="py-2 px-3 text-right font-mono text-sm text-slate-300">{row.voltage !== null ? formatFixedNumber(row.voltage, 1) : "—"}</td><td className="py-2 px-3 text-right font-mono text-sm text-slate-300">{row.current !== null ? formatFixedNumber(row.current, 1) : "—"}</td><td className="py-2 px-3 text-right font-mono text-sm text-slate-300">{row.loadKw !== null ? formatFixedNumber(row.loadKw, 1) : "—"}</td><td className="py-2 px-3 text-right font-mono text-sm text-slate-300">{row.loadKva !== null ? formatFixedNumber(row.loadKva, 1) : "—"}</td></tr>)}</tbody></table></div>
      </section>

      <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/30 flex justify-between items-center gap-2 text-xs text-slate-500 font-mono"><span>{th ? `${draftRecords.length} แถวสรุปรายเดือน` : `UPS Units: ${draftRecords.length} configured`}</span>{lastSaved ? <span className="text-slate-400">{copy.lastSaved}: {lastSaved}</span> : <span className="italic">{copy.noSaved}</span>}</div>
    </div>
  );
}
