import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AirTable from "../components/AirTable";
import DashboardStats from "../components/DashboardStats";
import DcTable from "../components/DcTable";
import EnergyCostTable from "../components/EnergyCostTable";
import SrinakarinPowerPhaseTable from "../components/SrinakarinPowerPhaseTable";
import StickyEntryToolbar from "../components/StickyEntryToolbar";
import UpsTable from "../components/UpsTable";
import { AlertTriangle } from "lucide-react";
import { computeCompletion, computeRackUnitCompletion, listMissingFields, type EntrySectionApi, type SectionCompletion } from "../utils/completion";
import type { AirRecord, DcRecord, EnergyCostRecord, MonthlyLog, SrinakarinInputSnapshot, UpsRecord } from "../types";
import WebEntryWorkflowHeader, { WebHistoricalEditNotice } from "./WebEntryWorkflowHeader";
import { formatWebSavedTimestamp } from "./formatting";
import RackUnitCapacityEntry, { type RackUnitCapacityEntryActions } from "./RackUnitCapacityEntry";
import { WebRackCapacityEntrySection, type WebRackCapacityEditorActions } from "./WebRackCapacityEditors";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { monthLabelLong } from "../utils/monthUtils";

type Section = "ups" | "air" | "dc" | "energy";
export type LiveDrafts = { ups?: UpsRecord[]; srinakarinInputs?: SrinakarinInputSnapshot; air?: AirRecord; dc?: DcRecord[]; energy?: EnergyCostRecord };
export type EntryWorkspaceActions = { saveAll: () => Promise<boolean>; resetAll: () => void };
type PendingHistoricalSave = { scope: "section" | "all"; execute: () => Promise<boolean>; resolve: (result: boolean) => void };

export function mergeEntryDraft(draft: MonthlyLog, updates: LiveDrafts): MonthlyLog {
  return {
    ...draft,
    ups: updates.ups ?? draft.ups,
    srinakarinInputs: updates.srinakarinInputs ?? draft.srinakarinInputs,
    air: updates.air ?? draft.air,
    dc: updates.dc ?? draft.dc,
    energyCost: updates.energy ?? draft.energyCost
  };
}

/** Full browser implementation of Desktop's entry workspace.
 * Save All first combines every in-page draft into one MonthlyLog and calls
 * the Web API once, preserving its row-version concurrency contract. */
export default function WebEntryWorkspace({ lang, siteId, siteName, siteCode, months, month, draft, rackUnitInitialRow, busy, readOnly = false, allowedStartMonth, allowedEndMonth, onSave, onSelectMonth, onRackUnitSaved, onRackCapacitySaved, onNotice, onDirtyChange, onRegisterActions }: {
  lang: "th" | "en";
  siteId: number;
  siteName: string;
  siteCode: string;
  months: string[];
  month: string;
  draft: MonthlyLog;
  rackUnitInitialRow: RackUnitCapacityRow | null;
  busy: boolean;
  readOnly?: boolean;
  allowedStartMonth: string;
  allowedEndMonth: string;
  onSave: (patch: Partial<MonthlyLog>) => Promise<boolean>;
  onSelectMonth: (month: string, exists: boolean) => void;
  onRackUnitSaved: () => Promise<void> | void;
  onRackCapacitySaved: () => Promise<void> | void;
  onNotice: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onRegisterActions?: (actions: EntryWorkspaceActions | null) => void;
}) {
  const th = lang === "th";
  const monthLabel = monthLabelLong(month, lang);
  const sectionApisRef = useRef<Partial<Record<Section, EntrySectionApi>>>({});
  const rackUnitActionsRef = useRef<RackUnitCapacityEntryActions | null>(null);
  const rackCapacityActionsRef = useRef<WebRackCapacityEditorActions | null>(null);
  const draftsRef = useRef<LiveDrafts>({});
  const [draftTick, setDraftTick] = useState(0);
  const [savingAll, setSavingAll] = useState(false);
  const [rackUnitDirty, setRackUnitDirty] = useState(false);
  const [rackCapacityDirty, setRackCapacityDirty] = useState(false);
  const [rackUnitCompletion, setRackUnitCompletion] = useState<SectionCompletion>(() => computeRackUnitCompletion(rackUnitInitialRow?.totalU, rackUnitInitialRow?.availableU));
  const [pendingHistoricalSave, setPendingHistoricalSave] = useState<PendingHistoricalSave | null>(null);

  const register = useCallback((section: Section) => (api: EntrySectionApi | null) => { if (api) sectionApisRef.current[section] = api; else delete sectionApisRef.current[section]; }, []);
  const registerRackUnitActions = useCallback((actions: RackUnitCapacityEntryActions | null) => { rackUnitActionsRef.current = actions; }, []);
  const registerRackCapacityActions = useCallback((actions: WebRackCapacityEditorActions | null) => { rackCapacityActionsRef.current = actions; }, []);
  const reportDraft = useCallback((section: keyof LiveDrafts, value: LiveDrafts[keyof LiveDrafts]) => { draftsRef.current[section] = value as never; setDraftTick(tick => tick + 1); }, []);
  const liveDraft = useMemo<MonthlyLog>(() => mergeEntryDraft(draft, draftsRef.current), [draft, draftTick]);
  const completion = useMemo(() => computeCompletion(liveDraft), [liveDraft]);
  const registeredApis = () => Object.values(sectionApisRef.current).filter((api): api is EntrySectionApi => api !== undefined);
  const hasMonthlyDraftChanges = useMemo(() => registeredApis().some(api => api.hasChanges()), [draftTick, draft]);
  const hasDraftChanges = useMemo(() => hasMonthlyDraftChanges || rackCapacityDirty || rackUnitDirty, [hasMonthlyDraftChanges, rackCapacityDirty, rackUnitDirty]);
  useEffect(() => { onDirtyChange?.(hasDraftChanges); }, [hasDraftChanges, onDirtyChange]);
  const latestMonth = months.at(-1) ?? null;
  const lastSaved = formatWebSavedTimestamp(draft.lastSavedUps ?? draft.lastSavedAir ?? draft.lastSavedDc ?? draft.lastSavedEnergyCost ?? null);
  const isHistorical = latestMonth !== null && month !== latestMonth;

  const resetAll = useCallback(() => {
    registeredApis().forEach(api => api.reset());
    rackCapacityActionsRef.current?.reset();
    rackUnitActionsRef.current?.reset();
    draftsRef.current = {};
    setRackCapacityDirty(false);
    setRackUnitDirty(false);
    setDraftTick(tick => tick + 1);
  }, []);
  const saveAll = useCallback(async (): Promise<boolean> => {
    if (!hasDraftChanges || savingAll || busy) return !hasDraftChanges;
    if (hasMonthlyDraftChanges) {
      const missing = listMissingFields(liveDraft);
      if (missing.length > 0) { onNotice(`Complete ${missing.length} required field${missing.length === 1 ? "" : "s"} before saving all sections.`); return false; }
    }
    setSavingAll(true);
    try {
      if (hasMonthlyDraftChanges) {
        const saved = await onSave({ ups: liveDraft.ups, srinakarinInputs: liveDraft.srinakarinInputs, air: liveDraft.air, dc: liveDraft.dc, energyCost: liveDraft.energyCost });
        if (!saved) return false;
      }
      const rackCapacityActions = rackCapacityActionsRef.current;
      const shouldSaveRackCapacity = rackCapacityActions ? rackCapacityActions.hasChanges() : rackCapacityDirty;
      if (shouldSaveRackCapacity) {
        if (!rackCapacityActions || !await rackCapacityActions.save()) return false;
      }
      const rackUnitActions = rackUnitActionsRef.current;
      const shouldSaveRackUnit = rackUnitActions ? rackUnitActions.hasChanges() : rackUnitDirty;
      if (shouldSaveRackUnit) {
        if (!rackUnitActions) return false;
        if (!await rackUnitActions.save()) return false;
      }
      return true;
    } finally { setSavingAll(false); }
  }, [busy, hasDraftChanges, hasMonthlyDraftChanges, liveDraft, onNotice, onSave, rackCapacityDirty, rackUnitDirty, savingAll]);
  const askHistoricalSave = useCallback((scope: PendingHistoricalSave["scope"], execute: () => Promise<boolean>) => {
    if (!isHistorical) return execute();
    return new Promise<boolean>(resolve => setPendingHistoricalSave({ scope, execute, resolve }));
  }, [isHistorical]);
  const requestSectionSave = useCallback((section: Section, patch: Partial<MonthlyLog>) => {
    const missing = listMissingFields({ ...liveDraft, ...patch }).filter(item => item.section === section);
    if (missing.length > 0) {
      onNotice(`Complete ${missing.length} required ${section} field${missing.length === 1 ? "" : "s"} before saving.`);
      return Promise.resolve(false);
    }
    return askHistoricalSave("section", () => onSave(patch));
  }, [askHistoricalSave, liveDraft, onNotice, onSave]);
  const requestSaveAll = useCallback(() => {
    if (hasDraftChanges && listMissingFields(liveDraft).length > 0) return saveAll();
    return askHistoricalSave("all", saveAll);
  }, [askHistoricalSave, hasDraftChanges, liveDraft, saveAll]);
  const cancelHistoricalSave = () => {
    const pending = pendingHistoricalSave;
    setPendingHistoricalSave(null);
    pending?.resolve(false);
  };
  const confirmHistoricalSave = async () => {
    const pending = pendingHistoricalSave;
    if (!pending) return;
    setPendingHistoricalSave(null);
    try { pending.resolve(await pending.execute()); } catch { pending.resolve(false); }
  };
  useEffect(() => { onRegisterActions?.({ saveAll, resetAll }); return () => onRegisterActions?.(null); }, [onRegisterActions, resetAll, saveAll]);
  const jumpToSection = useCallback((section: Section | "rack" | "rackUnit") => document.getElementById(`entry-section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), []);

  return <div className="space-y-5 pb-40 md:pb-24">
    <WebEntryWorkflowHeader lang={lang} facilityName={siteName} months={months} selectedMonth={month} draft={liveDraft} allowedStartMonth={allowedStartMonth} allowedEndMonth={allowedEndMonth} onSelectMonth={onSelectMonth} />
    <WebHistoricalEditNotice lang={lang} selectedMonth={month} latestMonth={latestMonth} onReturnToLatest={() => { if (latestMonth) onSelectMonth(latestMonth, true); }} />
    {readOnly && <p role="status" className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">{th ? "ระบบอยู่ในโหมดอ่านอย่างเดียว — กรอกและตรวจสอบข้อมูลได้ แต่ยังบันทึกไม่ได้" : "The system is in read-only mode — you can enter and review data, but saving is disabled."}</p>}
    <DashboardStats lang={lang} log={liveDraft} />
    <section className="space-y-5"><div><h2 className="font-display text-2xl font-bold">{th ? "กรอกข้อมูลรายเดือน" : "Monthly Data Entry"}</h2><p className="mt-1 text-sm text-slate-400">{th ? `กรอกและตรวจสอบค่าการทำงานรายเดือนของ UPS สำหรับ ${monthLabel} แล้วบันทึกข้อมูลทั้งหมด` : `Enter and verify the monthly UPS operating readings for ${monthLabel}, then save all records.`}</p></div>
      <div id="entry-section-ups">{siteCode === "srinakarin" ? <SrinakarinPowerPhaseTable lang={lang} monthStr={month} initialLog={draft} lastSaved={formatWebSavedTimestamp(draft.lastSavedUps)} onSave={(ups, srinakarinInputs) => requestSectionSave("ups", { ups, srinakarinInputs })} registerApi={register("ups")} onDraftChange={(ups, srinakarinInputs) => { reportDraft("ups", ups); reportDraft("srinakarinInputs", srinakarinInputs); }} /> : <UpsTable lang={lang} monthStr={month} initialRecords={draft.ups} lastSaved={formatWebSavedTimestamp(draft.lastSavedUps)} onSave={ups => requestSectionSave("ups", { ups })} registerApi={register("ups")} onDraftChange={ups => reportDraft("ups", ups)} />}</div>
      <div id="entry-section-air"><AirTable lang={lang} monthStr={month} initialRecord={draft.air} lastSaved={formatWebSavedTimestamp(draft.lastSavedAir)} meterFields={draft.energyCalculation?.airFields} onSave={air => requestSectionSave("air", { air })} registerApi={register("air")} onDraftChange={air => reportDraft("air", air)} /></div>
      <div id="entry-section-dc"><DcTable lang={lang} monthStr={month} initialRecords={draft.dc} lastSaved={formatWebSavedTimestamp(draft.lastSavedDc)} onSave={dc => requestSectionSave("dc", { dc })} registerApi={register("dc")} onDraftChange={dc => reportDraft("dc", dc)} /></div>
      <div id="entry-section-energy"><EnergyCostTable lang={lang} monthStr={month} initialRecord={draft.energyCost} lastSaved={formatWebSavedTimestamp(draft.lastSavedEnergyCost)} onSave={energyCost => requestSectionSave("energy", { energyCost })} registerApi={register("energy")} onDraftChange={energy => reportDraft("energy", energy)} /></div>
      <div id="entry-section-rack"><WebRackCapacityEntrySection siteId={siteId} siteName={siteName} month={month} readOnly={readOnly} onSaved={onRackCapacitySaved} onDirtyChange={setRackCapacityDirty} onRegisterActions={registerRackCapacityActions} /></div>
      <div id="entry-section-rack-unit"><RackUnitCapacityEntry siteId={siteId} month={month} initialRow={rackUnitInitialRow} onSaved={onRackUnitSaved} onMessage={onNotice} onCompletionChange={setRackUnitCompletion} onDirtyChange={setRackUnitDirty} onRegisterActions={registerRackUnitActions} /></div>
    </section>
    <StickyEntryToolbar lang={lang} completion={completion} rackUnitCompletion={rackUnitCompletion} lastSaved={lastSaved} readOnly={readOnly} workbookStatus={readOnly ? "readonly" : savingAll || busy ? "busy" : hasDraftChanges ? "dirty" : "saved"} hasDraftChanges={hasDraftChanges} aboveMobileNav facilityName={siteName} monthLabel={month} provider="Production API" onSaveAll={() => void requestSaveAll()} onResetAll={resetAll} onJumpToSection={jumpToSection} />
    {pendingHistoricalSave && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="historical-save-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"><div className="space-y-4 p-6"><div className="flex items-center gap-3"><div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-amber-400"><AlertTriangle className="h-5 w-5" /></div><div><h3 id="historical-save-title" className="font-display text-base font-bold text-slate-100">{th ? "ยืนยันการบันทึกข้อมูลย้อนหลัง" : "Confirm Saving Historical Data"}</h3><p className="mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">{th ? `เดือน: ${month}` : `Log month: ${month}`}</p></div></div><div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-xs leading-relaxed text-slate-300"><p>{th ? "คุณกำลังแก้ไขข้อมูลย้อนหลังนอกเหนือจากเดือนล่าสุด โปรดตรวจสอบตัวเลขก่อนบันทึก" : "You are saving edits to a historical record outside the latest available month. Review all figures before saving."}</p><p className="font-medium text-amber-400">{th ? "การแก้ไขนี้จะมีผลต่อการคำนวณและรายงานย้อนหลัง" : "This change affects historical calculations and reports."}</p></div><div className="flex gap-2.5 pt-2"><button type="button" onClick={cancelHistoricalSave} className="flex-1 rounded-xl border border-slate-700/50 bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-300">{th ? "ยกเลิก / ตรวจสอบอีกครั้ง" : "Cancel / Verify Again"}</button><button type="button" onClick={() => void confirmHistoricalSave()} className="flex-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white">{th ? "ยืนยันและบันทึก" : "Confirm & Save"}</button></div></div></section></div>}
  </div>;
}
