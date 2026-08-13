import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AirTable from "../components/AirTable";
import DashboardStats from "../components/DashboardStats";
import DcTable from "../components/DcTable";
import EnergyCostTable from "../components/EnergyCostTable";
import SrinakarinPowerPhaseTable from "../components/SrinakarinPowerPhaseTable";
import StickyEntryToolbar from "../components/StickyEntryToolbar";
import UpsTable from "../components/UpsTable";
import { computeCompletion, listMissingFields, type EntrySectionApi } from "../utils/completion";
import type { AirRecord, DcRecord, EnergyCostRecord, MonthlyLog, SrinakarinInputSnapshot, UpsRecord } from "../types";
import WebEntryWorkflowHeader, { WebHistoricalEditNotice } from "./WebEntryWorkflowHeader";

type Section = "ups" | "air" | "dc" | "energy";
export type LiveDrafts = { ups?: UpsRecord[]; srinakarinInputs?: SrinakarinInputSnapshot; air?: AirRecord; dc?: DcRecord[]; energy?: EnergyCostRecord };

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
export default function WebEntryWorkspace({ siteName, siteCode, months, month, draft, busy, allowedStartMonth, allowedEndMonth, onSave, onSelectMonth, onOpenReports, onNotice, onDirtyChange }: {
  siteName: string;
  siteCode: string;
  months: string[];
  month: string;
  draft: MonthlyLog;
  busy: boolean;
  allowedStartMonth: string;
  allowedEndMonth: string;
  onSave: (patch: Partial<MonthlyLog>) => Promise<void>;
  onSelectMonth: (month: string) => void;
  onOpenReports: () => void;
  onNotice: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const sectionApisRef = useRef<Partial<Record<Section, EntrySectionApi>>>({});
  const draftsRef = useRef<LiveDrafts>({});
  const [draftTick, setDraftTick] = useState(0);
  const [savingAll, setSavingAll] = useState(false);

  const register = useCallback((section: Section) => (api: EntrySectionApi | null) => { if (api) sectionApisRef.current[section] = api; else delete sectionApisRef.current[section]; }, []);
  const reportDraft = useCallback((section: keyof LiveDrafts, value: LiveDrafts[keyof LiveDrafts]) => { draftsRef.current[section] = value as never; setDraftTick(tick => tick + 1); }, []);
  const liveDraft = useMemo<MonthlyLog>(() => mergeEntryDraft(draft, draftsRef.current), [draft, draftTick]);
  const completion = useMemo(() => computeCompletion(liveDraft), [liveDraft]);
  const registeredApis = () => Object.values(sectionApisRef.current).filter((api): api is EntrySectionApi => api !== undefined);
  const hasDraftChanges = useMemo(() => registeredApis().some(api => api.hasChanges()), [draftTick, draft]);
  useEffect(() => { onDirtyChange?.(hasDraftChanges); }, [hasDraftChanges, onDirtyChange]);
  const latestMonth = months.at(-1) ?? null;
  const lastSaved = draft.lastSavedUps ?? draft.lastSavedAir ?? draft.lastSavedDc ?? draft.lastSavedEnergyCost ?? null;

  const resetAll = useCallback(() => {
    registeredApis().forEach(api => api.reset());
    draftsRef.current = {};
    setDraftTick(tick => tick + 1);
  }, []);
  const saveAll = useCallback(() => {
    if (!hasDraftChanges || savingAll || busy) return;
    const missing = listMissingFields(liveDraft);
    if (missing.length > 0) { onNotice(`Complete ${missing.length} required field${missing.length === 1 ? "" : "s"} before saving all sections.`); return; }
    setSavingAll(true);
    void onSave({ ups: liveDraft.ups, srinakarinInputs: liveDraft.srinakarinInputs, air: liveDraft.air, dc: liveDraft.dc, energyCost: liveDraft.energyCost }).finally(() => setSavingAll(false));
  }, [busy, hasDraftChanges, liveDraft, onNotice, onSave, savingAll]);
  const jumpToSection = useCallback((section: Section) => document.getElementById(`entry-section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), []);

  return <div className="space-y-5 pb-40 md:pb-24">
    <WebEntryWorkflowHeader facilityName={siteName} months={months} selectedMonth={month} draft={liveDraft} allowedStartMonth={allowedStartMonth} allowedEndMonth={allowedEndMonth} onSelectMonth={onSelectMonth} />
    <WebHistoricalEditNotice selectedMonth={month} latestMonth={latestMonth} onReturnToLatest={() => { if (latestMonth) onSelectMonth(latestMonth); }} />
    <DashboardStats log={liveDraft} />
    <section className="space-y-5"><div><h2 className="font-display text-2xl font-bold">Monthly Data Entry</h2><p className="mt-1 text-sm text-slate-400">Enter validated operating readings for {month}; Save All sends one concurrency-protected Production API update.</p></div>
      <div id="entry-section-ups">{siteCode === "srinakarin" ? <SrinakarinPowerPhaseTable monthStr={month} initialLog={draft} lastSaved={draft.lastSavedUps} onSave={(ups, srinakarinInputs) => void onSave({ ups, srinakarinInputs })} registerApi={register("ups")} onDraftChange={(ups, srinakarinInputs) => { reportDraft("ups", ups); reportDraft("srinakarinInputs", srinakarinInputs); }} /> : <UpsTable monthStr={month} initialRecords={draft.ups} lastSaved={draft.lastSavedUps} onSave={ups => void onSave({ ups })} registerApi={register("ups")} onDraftChange={ups => reportDraft("ups", ups)} />}</div>
      <div id="entry-section-air"><AirTable monthStr={month} initialRecord={draft.air} lastSaved={draft.lastSavedAir} meterFields={draft.energyCalculation?.airFields} onSave={air => void onSave({ air })} registerApi={register("air")} onDraftChange={air => reportDraft("air", air)} /></div>
      <div id="entry-section-dc"><DcTable monthStr={month} initialRecords={draft.dc} lastSaved={draft.lastSavedDc} onSave={dc => void onSave({ dc })} registerApi={register("dc")} onDraftChange={dc => reportDraft("dc", dc)} /></div>
      <div id="entry-section-energy"><EnergyCostTable monthStr={month} initialRecord={draft.energyCost} lastSaved={draft.lastSavedEnergyCost} onSave={energyCost => void onSave({ energyCost })} registerApi={register("energy")} onDraftChange={energy => reportDraft("energy", energy)} /></div>
    </section>
    <StickyEntryToolbar lang="en" completion={completion} lastSaved={lastSaved} workbookStatus={savingAll || busy ? "busy" : hasDraftChanges ? "dirty" : "saved"} hasDraftChanges={hasDraftChanges} aboveMobileNav facilityName={siteName} monthLabel={month} provider="Production API" onSaveAll={saveAll} onResetAll={resetAll} onExport={onOpenReports} onJumpToSection={jumpToSection} />
  </div>;
}
