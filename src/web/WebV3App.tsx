import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, Boxes, Calculator, ChartNoAxesCombined, Database, FileDown, FileText, Gauge, LogOut, Printer, RefreshCw, Settings, ShieldAlert, ShieldCheck, Table2, Upload, Zap } from "lucide-react";
import { Line, LineChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiDownload, apiRequest, ApiError, type SessionUser } from "./apiClient";
import { buildWebWorkbook } from "./workbookExport";
import { buildCombinedCsv } from "../utils/exportData";
import UpsTable from "../components/UpsTable";
import AirTable from "../components/AirTable";
import DcTable from "../components/DcTable";
import EnergyCostTable from "../components/EnergyCostTable";
import SrinakarinPowerPhaseTable from "../components/SrinakarinPowerPhaseTable";
import StickyEntryToolbar from "../components/StickyEntryToolbar";
import ReportingCenter, { type ReportRequest, type ReportPreviewRequest } from "../reporting/ReportingCenter";
import type { AirRecord, DcRecord, EnergyCostRecord, UpsRecord } from "../types";
import { formatTimestamp } from "../utils";
import { computeCompletion, listMissingFields, type EntrySectionApi, type MissingField } from "../utils/completion";
import { WebHistoricalPage, WebRackCapacitySurface, WebRackUnitEditor } from "./WebHistoricalAndRackEditors";

interface SiteState { site: { id: number; code: string; name: string; active: boolean }; availableMonths: string[]; latestAvailableMonth: string | null; }
interface BootstrapState { formulaVersion: string; displayPeriod: { startMonth: string; endMonth: string; rowVersion: number }; allowedMonths: string[]; availableMonths: string[]; latestAvailableMonth: string | null; sites: SiteState[]; readOnlyMode?: boolean; }
interface Calculation { buildingEnergyKwh: number | null; buildingElectricityCostThb: number | null; upsEnergyKwh: number | null; airEnergyKwh: number | null; dcEnergyKwh: number | null; floorEnergyKwh: number | null; floorElectricityCostThb: number | null; averageElectricityRateThbPerKwh: number | null; energySharePercent: number | null; }

function formatNumber(value: unknown, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

function LoginView({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ user: SessionUser }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      setPassword("");
      onAuthenticated(result.user);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 423) setError("บัญชีถูกระงับชั่วคราว กรุณาลองใหม่ภายหลัง");
      else if (cause instanceof ApiError && cause.status === 429) setError("มีการพยายามเข้าสู่ระบบมากเกินไป กรุณาลองใหม่ภายหลัง");
      else setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    } finally {
      setBusy(false);
    }
  };

  return <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
    <form onSubmit={submit} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-7 shadow-2xl space-y-5">
      <div><p className="text-[11px] uppercase tracking-[0.2em] text-indigo-400 font-bold">Energy Monitor Web v3</p><h1 className="text-2xl font-semibold mt-2">เข้าสู่ระบบ</h1><p className="text-sm text-slate-400 mt-2">ใช้ Username และ Password ของระบบงานเท่านั้น</p></div>
      <label className="block space-y-1.5"><span className="text-xs text-slate-400 font-semibold">Username</span><input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500" required /></label>
      <label className="block space-y-1.5"><span className="text-xs text-slate-400 font-semibold">Password</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500" required /></label>
      {error && <p role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 font-semibold">{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>
    </form>
  </main>;
}

function MetricCard({ label, value, unit }: { label: string; value: unknown; unit?: string }) {
  return <article className="bg-slate-900 border border-slate-800 rounded-2xl p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold mt-2">{formatNumber(value)}</p>{unit && <p className="text-xs text-slate-500 mt-1">{unit}</p>}</article>;
}

function EmptyState({ message = "ยังไม่มีข้อมูลในช่วงที่เลือก" }: { message?: string }) {
  return <section className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400"><Database className="mx-auto mb-3 w-8 h-8 text-slate-600" /><p>{message}</p></section>;
}

function LoadingState() { return <section className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400"><RefreshCw className="mx-auto mb-3 w-8 h-8 animate-spin text-indigo-400" /><p>กำลังโหลดข้อมูล…</p></section>; }

interface MonthlyLogResponse { siteId: number; month: string; rowVersion: number | null; log: any | null; calculation: Calculation | null; }
type WebSectionKey = "ups" | "air" | "dc" | "energyCost";
interface WebSectionTimestamps { ups: string | null; air: string | null; dc: string | null; energyCost: string | null; }

function rawEditorLog(log: any): any {
  return {
    month: log.month,
    ups: log.ups ?? [],
    air: log.air ?? { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} },
    dc: log.dc ?? [],
    energyCost: {
      buildingEnergyKwh: log.energyCost?.buildingEnergyKwh ?? null,
      buildingElectricityCostThb: log.energyCost?.buildingElectricityCostThb ?? null
    },
    lastSavedUps: log.lastSavedUps ?? null,
    lastSavedAir: log.lastSavedAir ?? null,
    lastSavedDc: log.lastSavedDc ?? null,
    lastSavedEnergyCost: log.lastSavedEnergyCost ?? null,
    ...(log.energyCalculation ? { energyCalculation: log.energyCalculation } : {}),
    ...(log.srinakarinInputs ? { srinakarinInputs: log.srinakarinInputs } : {})
  };
}

function emptyEditorLog(month: string): any {
  return { month, ups: [], air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} }, dc: [], energyCost: { buildingEnergyKwh: null, buildingElectricityCostThb: null }, lastSavedUps: null, lastSavedAir: null, lastSavedDc: null, lastSavedEnergyCost: null };
}

function editorError(cause: unknown): string {
  if (!(cause instanceof ApiError)) return "ไม่สามารถบันทึกข้อมูลได้";
  if (cause.status === 400) return `ข้อมูลไม่ถูกต้อง: ${cause.message}`;
  if (cause.status === 401) return "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่";
  if (cause.status === 403) return "ไม่มีสิทธิ์แก้ไขข้อมูลชุดนี้";
  if (cause.status === 409) return "ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดค่าล่าสุดก่อนบันทึกอีกครั้ง";
  if (cause.status === 423) return "READ_ONLY_MODE: ระบบอยู่ในโหมดอ่านข้อมูลเท่านั้น";
  if (cause.status === 429) return "มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง";
  if (cause.status >= 500) return "ระบบปลายทางไม่พร้อม กรุณาลองใหม่ภายหลัง";
  return cause.message || "ไม่สามารถบันทึกข้อมูลได้";
}

function OperationalEditor({ siteId, month, readOnly, onDirty, onSaved }: { siteId: number; month: string; readOnly: boolean; onDirty: (dirty: boolean) => void; onSaved: () => void }) {
  const [data, setData] = useState<MonthlyLogResponse | null>(null);
  const [rawText, setRawText] = useState("");
  const [initialText, setInitialText] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"Idle" | "Saving" | "Saved" | "Error">("Idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!siteId || !month) { setData(null); setRawText(""); setInitialText(""); onDirty(false); return; }
    setLoading(true); setError(null);
    try {
      const result = await apiRequest<MonthlyLogResponse>(`/sites/${siteId}/periods/${encodeURIComponent(month)}`);
      const nextText = JSON.stringify(result.log ? rawEditorLog(result.log) : emptyEditorLog(month), null, 2);
      setData(result); setRawText(nextText); setInitialText(nextText); onDirty(false); setStatus("Idle");
    } catch (cause) { setData(null); setError(editorError(cause)); } finally { setLoading(false); }
  }, [month, onDirty, siteId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onDirty(Boolean(rawText) && rawText !== initialText); }, [initialText, onDirty, rawText]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || status === "Saving" || !data) return;
    let log: unknown;
    try { log = JSON.parse(rawText); } catch { setStatus("Error"); setError("Raw input JSON ไม่ถูกต้อง"); return; }
    setStatus("Saving"); setError(null);
    try {
      await apiRequest(`/sites/${siteId}/periods/${encodeURIComponent(month)}`, {
        method: "PUT",
        body: JSON.stringify({ log, expected_row_version: data.rowVersion, provenance: { source_type: "web-api", source_location: `site:${siteId}/month:${month}` } })
      });
      setStatus("Saved");
      await load();
      onSaved();
    } catch (cause) { setStatus("Error"); setError(editorError(cause)); }
  };

  if (!siteId || !month) return null;
  return <section className="mt-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4" data-testid="operational-editor">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Operational write</p><h2 className="text-xl font-semibold mt-1">Raw inputs — {month}</h2><p className="text-xs text-slate-500 mt-1">แก้ไขเฉพาะ raw inputs; ค่าพลังงาน/ค่าใช้จ่าย derived คำนวณใหม่จาก domain layer หลังบันทึก</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status === "Error" ? "bg-rose-500/15 text-rose-300" : status === "Saving" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>{status}</span></div>
    {readOnly && <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">READ_ONLY_MODE: operational writes are disabled by the server.</p>}
    {loading && <p className="text-sm text-slate-400">กำลังโหลด raw inputs…</p>}
    {error && <div role="alert" className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3"><span>{error}</span>{status === "Error" && <button type="button" onClick={() => void load()} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold">โหลดค่าล่าสุด</button>}</div>}
    {!loading && data && <form onSubmit={save} className="space-y-3"><textarea aria-label="Raw operational inputs" value={rawText} onChange={event => { setRawText(event.target.value); setStatus("Idle"); }} disabled={readOnly || status === "Saving"} spellCheck={false} className="w-full min-h-80 bg-slate-950 border border-slate-700 rounded-xl p-3 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-60" /><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">row_version: {data.rowVersion ?? "new"} · null และ 0 จะถูกเก็บตามความหมายเดิม</p><button type="submit" disabled={readOnly || status === "Saving" || rawText === initialText} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold">{status === "Saving" ? "กำลังบันทึก…" : "บันทึก raw inputs"}</button></div></form>}
    {!loading && !data && !error && <p className="text-sm text-slate-400">ยังไม่มี monthly dataset สำหรับช่วงนี้</p>}
    {data?.calculation && <details className="text-sm"><summary className="cursor-pointer font-semibold text-slate-300">Derived calculation (read-only)</summary><div className="mt-3"><CalculationCards calculation={data.calculation} /></div></details>}
  </section>;
}

function StructuredOperationalEditor({ siteId, month, latestAvailableMonth, readOnly, onDirty, onSaved }: { siteId: number; month: string; latestAvailableMonth: string | null; readOnly: boolean; onDirty: (dirty: boolean) => void; onSaved: () => void }) {
  const [data, setData] = useState<MonthlyLogResponse | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [initialText, setInitialText] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"Idle" | "Saving" | "Saved" | "Error">("Idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<WebSectionTimestamps>({ ups: null, air: null, dc: null, energyCost: null });
  const [validationIssues, setValidationIssues] = useState<MissingField[] | null>(null);
  const [highlightSections, setHighlightSections] = useState<Set<MissingField["section"]>>(new Set());
  const [draftTick, setDraftTick] = useState(0);
  const sectionApisRef = useRef<Record<string, EntrySectionApi | null>>({});
  const pendingDraftRef = useRef<any | null>(null);
  const batchSaveRef = useRef(false);

  const load = useCallback(async () => {
    if (!siteId || !month) { setData(null); setDraft(null); pendingDraftRef.current = null; setInitialText(""); onDirty(false); return; }
    setLoading(true); setError(null);
    try {
      const result = await apiRequest<MonthlyLogResponse>(`/sites/${siteId}/periods/${encodeURIComponent(month)}`);
      const nextDraft = result.log ? rawEditorLog(result.log) : emptyEditorLog(month);
      pendingDraftRef.current = nextDraft;
      setData(result); setDraft(nextDraft); setLastSaved({ ups: nextDraft.lastSavedUps ?? null, air: nextDraft.lastSavedAir ?? null, dc: nextDraft.lastSavedDc ?? null, energyCost: nextDraft.lastSavedEnergyCost ?? null }); setValidationIssues(null); setHighlightSections(new Set()); setInitialText(JSON.stringify(nextDraft)); setStatus("Idle"); setDraftTick(value => value + 1); onDirty(false);
    } catch (cause) { setData(null); setDraft(null); pendingDraftRef.current = null; setError(editorError(cause)); } finally { setLoading(false); }
  }, [month, onDirty, siteId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const current = pendingDraftRef.current; onDirty(Boolean(current) && JSON.stringify(current) !== initialText); }, [draftTick, initialText, onDirty]);

  const markDraftDirty = useCallback((patch: Record<string, unknown>) => {
    if (!pendingDraftRef.current) return;
    pendingDraftRef.current = { ...pendingDraftRef.current, ...patch };
    const changedSection = Object.keys(patch)[0] === "energyCost" ? "energy" : Object.keys(patch)[0] as MissingField["section"] | undefined;
    if (changedSection) setHighlightSections(previous => { const next = new Set(previous); next.delete(changedSection); return next; });
    setStatus("Idle");
    setDraftTick(value => value + 1);
    onDirty(JSON.stringify(pendingDraftRef.current) !== initialText);
  }, [initialText, onDirty]);
  const raiseValidation = useCallback((fields: MissingField[]) => {
    setValidationIssues(fields);
    setHighlightSections(new Set(fields.map(field => field.section)));
    const first = fields[0];
    if (!first) return;
    const container = document.getElementById(`entry-section-${first.section}`);
    container?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      container?.querySelector<HTMLInputElement>("input:placeholder-shown")?.focus({ preventScroll: true });
    }, 450);
  }, []);
  useEffect(() => {
    const sections: readonly MissingField["section"][] = ["ups", "air", "dc", "energy"];
    sections.forEach(section => {
      const element = document.getElementById(`entry-section-${section}`);
      element?.classList.toggle("highlight-missing", highlightSections.has(section));
      element?.classList.toggle("ring-2", highlightSections.has(section));
      element?.classList.toggle("ring-rose-500/50", highlightSections.has(section));
      element?.classList.toggle("rounded-2xl", highlightSections.has(section));
    });
  }, [highlightSections]);
  const persist = useCallback(async (nextDraft: any, changedSections: readonly WebSectionKey[]) => {
    if (readOnly || status === "Saving" || !data) return;
    pendingDraftRef.current = nextDraft;
    setDraft(nextDraft); setStatus("Saving"); setError(null);
    try {
      await apiRequest(`/sites/${siteId}/periods/${encodeURIComponent(month)}`, {
        method: "PUT",
        body: JSON.stringify({ log: nextDraft, changed_sections: changedSections, expected_row_version: data.rowVersion, provenance: { source_type: "web-structured-entry", source_location: `site:${siteId}/month:${month}` } })
      });
      setStatus("Saved"); await load(); onSaved();
    } catch (cause) { setStatus("Error"); setError(editorError(cause)); }
  }, [data, load, month, onSaved, readOnly, siteId, status]);
  const isHistorical = Boolean(latestAvailableMonth && month !== latestAvailableMonth);
  const confirmHistoricalSave = useCallback(() => {
    if (!isHistorical || batchSaveRef.current) return true;
    return window.confirm(`The selected month (${month}) is not the latest available month (${latestAvailableMonth}). Save historical data?`);
  }, [isHistorical, latestAvailableMonth, month]);
  const savePart = useCallback((patch: Record<string, unknown>): boolean => {
    if (!pendingDraftRef.current || readOnly || status === "Saving") return false;
    const nextDraft = { ...pendingDraftRef.current, ...patch };
    pendingDraftRef.current = nextDraft;
    setDraftTick(value => value + 1);
    const section = Object.keys(patch)[0] as WebSectionKey | undefined;
    const sectionKey = section === "energyCost" ? "energy" : section;
    const missing = sectionKey ? listMissingFields(nextDraft, nextDraft.energyCalculation?.airFields).filter(item => item.section === sectionKey) : [];
    if (missing.length > 0 && !batchSaveRef.current) {
      setStatus("Error"); setError(`${sectionKey} section is incomplete: ${missing[0].label}`); raiseValidation(missing); onDirty(true); return false;
    }
    if (!section || !confirmHistoricalSave()) return false;
    const highlightKey = section === "energyCost" ? "energy" : section;
    setHighlightSections(previous => { const next = new Set(previous); next.delete(highlightKey); return next; });
    if (!batchSaveRef.current) void persist(nextDraft, [section]);
    return true;
  }, [confirmHistoricalSave, onDirty, persist, raiseValidation, readOnly, status]);
  const registerSection = useCallback((name: "ups" | "air" | "dc" | "energy") => (api: EntrySectionApi | null) => {
    sectionApisRef.current[name] = api;
  }, []);
  const jumpToSection = useCallback((section: "ups" | "air" | "dc" | "energy") => {
    document.getElementById(`entry-section-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const saveAll = useCallback(() => {
    if (readOnly || !data || !pendingDraftRef.current) return;
    const missing = listMissingFields(pendingDraftRef.current, pendingDraftRef.current.energyCalculation?.airFields);
    if (missing.length > 0) {
      setStatus("Error"); setError(`Incomplete data: ${missing[0].label}`); raiseValidation(missing); onDirty(true); jumpToSection(missing[0].section); return;
    }
    const changedSections = (Object.entries(sectionApisRef.current) as Array<["ups" | "air" | "dc" | "energy", EntrySectionApi | null]>)
      .filter(([, api]) => api?.hasChanges() === true)
      .map(([section]) => section === "energy" ? "energyCost" : section) as WebSectionKey[];
    if (changedSections.length === 0 || !confirmHistoricalSave()) return;
    batchSaveRef.current = true;
    try { (Object.values(sectionApisRef.current) as Array<EntrySectionApi | null>).forEach(api => api?.commit()); }
    finally { batchSaveRef.current = false; }
    const nextDraft = pendingDraftRef.current;
    if (nextDraft && JSON.stringify(nextDraft) !== initialText) void persist(nextDraft, changedSections);
  }, [confirmHistoricalSave, data, initialText, jumpToSection, onDirty, persist, raiseValidation, readOnly]);
  const resetAll = useCallback(() => {
    if (!draft) return;
    (Object.values(sectionApisRef.current) as Array<EntrySectionApi | null>).forEach(api => api?.reset());
    pendingDraftRef.current = draft;
    setDraftTick(value => value + 1);
    setStatus("Idle"); setError(null); onDirty(false);
  }, [draft, onDirty]);
  const liveDraft = pendingDraftRef.current;
  const completion = useMemo(() => computeCompletion(liveDraft, liveDraft?.energyCalculation?.airFields), [draftTick, liveDraft]);
  const hasDraftChanges = Boolean(liveDraft && JSON.stringify(liveDraft) !== initialText);

  if (!siteId || !month) return null;
  return <section className="mt-5 space-y-5" data-testid="operational-editor">
     {validationIssues && <div role="dialog" aria-modal="true" aria-labelledby="web-validation-title" className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/75 p-4"><div className="w-full max-w-xl rounded-2xl border border-rose-500/40 bg-slate-900 p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h3 id="web-validation-title" className="text-lg font-semibold text-rose-200">Validation required</h3><p className="mt-1 text-sm text-slate-400">{validationIssues.length} missing field(s) must be completed before saving.</p></div><button type="button" onClick={() => setValidationIssues(null)} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold">Close</button></div><ul className="mt-4 max-h-72 space-y-1.5 overflow-auto text-sm text-slate-300">{validationIssues.map((field, index) => <li key={`${field.section}-${field.label}-${index}`} className="rounded-lg bg-slate-950 px-3 py-2"><span className="text-rose-300">{field.section.toUpperCase()}</span> · {field.label}</li>)}</ul></div></div>}
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Operational write</p><h2 className="text-xl font-semibold mt-1">Structured data entry — {month}</h2><p className="text-xs text-slate-500 mt-1">Desktop-aligned UPS, air-conditioning, DC and energy-cost input sections. Derived values remain calculated by the shared domain layer.</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status === "Error" ? "bg-rose-500/15 text-rose-300" : status === "Saving" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>{status}</span></div>{readOnly && <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">READ_ONLY_MODE: operational writes are disabled by the server.</p>}{loading && <p className="text-sm text-slate-400">Loading structured inputs…</p>}{error && <div role="alert" className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold">Reload</button></div>}</div>
      {!loading && draft && <div className={readOnly ? "opacity-80 pointer-events-none" : "space-y-5"}><div id="entry-section-ups">{draft.srinakarinInputs ? <SrinakarinPowerPhaseTable monthStr={month} initialLog={draft} lastSaved={lastSaved.ups} registerApi={registerSection("ups")} onSave={(records, inputs) => savePart({ ups: records, srinakarinInputs: inputs })} onDraftChange={records => markDraftDirty({ ups: records })} /> : <UpsTable monthStr={month} initialRecords={(draft.ups ?? []) as UpsRecord[]} lastSaved={lastSaved.ups} registerApi={registerSection("ups")} onSave={records => savePart({ ups: records })} onDraftChange={records => markDraftDirty({ ups: records })} />}</div><div id="entry-section-air"><AirTable monthStr={month} initialRecord={(draft.air ?? {}) as AirRecord} lastSaved={lastSaved.air} meterFields={draft.energyCalculation?.airFields} registerApi={registerSection("air")} onSave={record => savePart({ air: record })} onDraftChange={record => markDraftDirty({ air: record })} /></div><div id="entry-section-dc"><DcTable monthStr={month} initialRecords={(draft.dc ?? []) as DcRecord[]} lastSaved={lastSaved.dc} registerApi={registerSection("dc")} onSave={records => savePart({ dc: records })} onDraftChange={records => markDraftDirty({ dc: records })} /></div><div id="entry-section-energy"><EnergyCostTable monthStr={month} initialRecord={(draft.energyCost ?? {}) as EnergyCostRecord} lastSaved={lastSaved.energyCost} registerApi={registerSection("energy")} onSave={record => savePart({ energyCost: record })} onDraftChange={record => markDraftDirty({ energyCost: record })} /></div></div>}
     {draft?.srinakarinInputs && <details className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><summary className="cursor-pointer text-sm font-semibold text-slate-300">Advanced facility-specific inputs</summary><p className="text-xs text-slate-500 mt-2">Phase/PPC source rows are edited and submitted with the structured save.</p><pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-400">{JSON.stringify(draft.srinakarinInputs, null, 2)}</pre></details>}
     {data?.calculation && <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><h3 className="text-sm font-semibold text-slate-300">Derived calculation (read-only)</h3><div className="mt-3"><CalculationCards calculation={data.calculation} /></div></section>}
      <StickyEntryToolbar lang="en" completion={completion} lastSaved={lastSaved.ups ?? lastSaved.air ?? lastSaved.dc ?? lastSaved.energyCost} workbookStatus={readOnly ? "readonly" : status === "Saving" ? "busy" : hasDraftChanges ? "dirty" : "saved"} hasDraftChanges={hasDraftChanges} readOnly={readOnly} facilityName={data?.siteId ? `Site ${data.siteId}` : null} monthLabel={month} provider="Web API" onSaveAll={saveAll} onResetAll={resetAll} onExport={() => window.location.assign("/reports")} onJumpToSection={jumpToSection} />
  </section>;
}

function Shell({ user, bootstrap, route, onNavigate, onLogout, children }: { user: SessionUser; bootstrap: BootstrapState; route: string; onNavigate: (path: string) => void; onLogout: () => Promise<void>; children: ReactNode }) {
  const links = [
    ["/dashboard", "Dashboard", Gauge], ["/energy", "Energy", Zap], ["/cost", "Cost", Calculator], ["/electrical", "Electrical", Activity], ["/history", "Historical Logs", Table2], ["/site-comparison", "Site Comparison", ChartNoAxesCombined], ["/racks", "Racks", Boxes], ["/rack-units", "Rack Units", Table2], ["/reports", "Reports", FileText]
  ] as const;
  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur"><div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex flex-wrap items-center gap-4 justify-between">
      <div><p className="text-[11px] uppercase tracking-[0.2em] text-indigo-400 font-bold">Energy Monitor</p><p className="text-lg font-semibold mt-1">Web v3</p></div>
      <div className="flex items-center gap-3 text-sm"><span className="text-slate-400">{user.displayName}</span><span className="rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-2.5 py-1 text-xs font-bold">{user.role}</span><button onClick={() => void onLogout()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-semibold"><LogOut className="w-3.5 h-3.5" /> ออกจากระบบ</button></div>
    </div><nav aria-label="Application" className="max-w-7xl mx-auto px-4 md:px-6 pb-3 flex flex-wrap gap-2">{links.map(([path, label, Icon]) => <a key={path} href={path} onClick={event => { event.preventDefault(); onNavigate(path); }} className={`rounded-xl px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 ${route === path ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"}`}><Icon className="w-3.5 h-3.5" />{label}</a>)}<a href="/settings" onClick={event => { event.preventDefault(); onNavigate("/settings"); }} className="rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5"><Settings className="w-3.5 h-3.5" /> Settings</a></nav></header>
    {bootstrap.readOnlyMode && <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-200 px-4 py-2 text-center text-xs font-semibold">READ_ONLY_MODE: ระบบอยู่ในโหมดอ่านข้อมูลเท่านั้น</div>}
    <main className="max-w-7xl mx-auto px-4 md:px-6 py-6">{children}</main>
  </div>;
}

function ScopeBar({ bootstrap, siteId, month, onSiteChange, onMonthChange }: { bootstrap: BootstrapState; siteId: number; month: string; onSiteChange: (id: number) => void; onMonthChange: (month: string) => void }) {
  const site = bootstrap.sites.find(item => item.site.id === siteId) ?? bootstrap.sites[0];
  const months = site?.availableMonths ?? bootstrap.availableMonths;
  return <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap gap-3 items-end"><label className="space-y-1"><span className="block text-xs text-slate-500">Site</span><select value={siteId} onChange={event => onSiteChange(Number(event.target.value))} className="field"><option value={0}>—</option>{bootstrap.sites.map(item => <option key={item.site.id} value={item.site.id}>{item.site.name}</option>)}</select></label><label className="space-y-1"><span className="block text-xs text-slate-500">Month</span><select value={month} onChange={event => onMonthChange(event.target.value)} className="field"><option value="">—</option>{months.map(item => <option key={item} value={item}>{item}</option>)}</select></label><p className="text-xs text-slate-500 pb-2">Global Display Period: {bootstrap.displayPeriod.startMonth} → {bootstrap.displayPeriod.endMonth}</p></div>;
}

function CalculationCards({ calculation }: { calculation: Calculation }) {
  return <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Building Energy" value={calculation.buildingEnergyKwh} unit="kWh" /><MetricCard label="Floor Energy" value={calculation.floorEnergyKwh} unit="kWh" /><MetricCard label="Floor Cost" value={calculation.floorElectricityCostThb} unit="THB" /><MetricCard label="Average Rate" value={calculation.averageElectricityRateThbPerKwh} unit="THB/kWh" /><MetricCard label="UPS Energy" value={calculation.upsEnergyKwh} unit="kWh" /><MetricCard label="Air Energy" value={calculation.airEnergyKwh} unit="kWh" /><MetricCard label="DC Energy" value={calculation.dcEnergyKwh} unit="kWh" /><MetricCard label="Energy Share" value={calculation.energySharePercent} unit="%" /></div>;
}

function EngineeringDashboardDetails({ snapshot }: { snapshot: any }) {
  return <div className="space-y-5">
    <section className="panel"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Engineering Dashboard</h2><p className="text-xs text-slate-500 mt-1">Shared Desktop-compatible UPS, Air, DC and energy calculations.</p></div><p className="text-xs text-slate-500">{snapshot.previousMonth ? `Previous month: ${snapshot.previousMonth}` : "Previous month: unavailable"}</p></div><div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="UPS Load" value={snapshot.totalUpsKw} unit="kW" /><MetricCard label="UPS Energy" value={snapshot.totalUpsEnergyKwh} unit="kWh" /><MetricCard label="DC Power" value={snapshot.totalDcPowerW} unit="W" /><MetricCard label="Air Energy" value={snapshot.airEnergyKwh} unit="kWh" /></div></section>
    <section className="panel overflow-x-auto"><h2 className="font-semibold mb-3">UPS Load Status</h2>{snapshot.upsGroups?.length ? <table className="min-w-[700px] w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-4">Group</th><th className="py-2 px-3">kW</th><th className="py-2 px-3">kVA</th><th className="py-2 px-3">Capacity</th><th className="py-2 px-3">Load %</th><th className="py-2 px-3">Monthly kWh</th></tr></thead><tbody className="divide-y divide-slate-800">{snapshot.upsGroups.map((row: any) => <tr key={row.name}><td className="py-2 pr-4 font-semibold">{row.name}</td><td className="py-2 px-3">{formatNumber(row.totalKw)}</td><td className="py-2 px-3">{formatNumber(row.totalKva)}</td><td className="py-2 px-3">{formatNumber(row.capacity)}</td><td className="py-2 px-3">{formatNumber(row.loadPercent)}%</td><td className="py-2 px-3">{formatNumber(row.monthlyEnergyKwh)}</td></tr>)}</tbody></table> : <p className="text-sm text-slate-400">No UPS group topology is configured for this site.</p>}</section>
    <div className="grid lg:grid-cols-2 gap-5"><section className="panel overflow-x-auto"><h2 className="font-semibold mb-3">Air Conditioning</h2>{snapshot.airFields?.length ? <table className="min-w-[540px] w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-4">Meter</th><th className="py-2 px-3">Previous</th><th className="py-2 px-3">Current</th><th className="py-2 px-3">Difference</th></tr></thead><tbody className="divide-y divide-slate-800">{snapshot.airFields.map((field: string) => <tr key={field}><td className="py-2 pr-4 font-mono">{field.toUpperCase()}</td><td className="py-2 px-3">{formatNumber(snapshot.airPrevious?.[field])}</td><td className="py-2 px-3">{formatNumber(snapshot.airCurrent?.[field])}</td><td className="py-2 px-3">{formatNumber(snapshot.airDifference?.[field])}</td></tr>)}</tbody></table> : <p className="text-sm text-slate-400">No Air meter fields are available.</p>}</section><section className="panel overflow-x-auto"><h2 className="font-semibold mb-3">DC Power Panels</h2>{snapshot.dcPanels?.length ? <table className="min-w-[540px] w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-4">Panel</th><th className="py-2 px-3">Voltage</th><th className="py-2 px-3">Current</th><th className="py-2 px-3">Power W</th><th className="py-2 px-3">Monthly kWh</th></tr></thead><tbody className="divide-y divide-slate-800">{snapshot.dcPanels.map((row: any) => <tr key={row.panelId}><td className="py-2 pr-4 font-mono">{row.panelId}</td><td className="py-2 px-3">{formatNumber(row.voltage)} V</td><td className="py-2 px-3">{formatNumber(row.current)} A</td><td className="py-2 px-3">{formatNumber(row.dcPowerW)} W</td><td className="py-2 px-3">{formatNumber(row.monthlyEnergyKwh)}</td></tr>)}</tbody></table> : <p className="text-sm text-slate-400">No DC panel rows are available.</p>}</section></div>
  </div>;
}

function RackRecordsTable({ records }: { records: any[] }) {
  if (!records.length) return <EmptyState message="No Rack Capacity records are available for this month." />;
  return <section className="panel overflow-x-auto"><h2 className="font-semibold mb-3">Rack Capacity Records</h2><table className="min-w-[980px] w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-3">Row</th><th className="py-2 px-3">Zone</th><th className="py-2 px-3">Rack ID</th><th className="py-2 px-3">Status</th><th className="py-2 px-3">Cabinet</th><th className="py-2 px-3">Detail</th><th className="py-2 px-3">Device Type</th><th className="py-2 px-3">Remarks</th></tr></thead><tbody className="divide-y divide-slate-800">{records.map((row: any, index: number) => <tr key={`${row.rackId ?? "row"}-${row.rowNumber ?? index}`}><td className="py-2 pr-3 text-slate-500">{row.rowNumber ?? index + 1}</td><td className="py-2 px-3">{row.rackZone ?? "—"}</td><td className="py-2 px-3 font-mono">{row.rackId ?? "—"}</td><td className="py-2 px-3">{row.status ?? "—"}</td><td className="py-2 px-3">{row.cabinetSize ?? "—"}</td><td className="py-2 px-3">{row.detail ?? "—"}</td><td className="py-2 px-3">{row.deviceType ?? "—"}</td><td className="py-2 px-3">{row.remarks ?? "—"}</td></tr>)}</tbody></table></section>;
}

function RackDetailPage({ data, kind }: { data: any; kind: "racks" | "rack-units" }) {
  if (kind === "racks") {
    const metrics = data.snapshot?.metrics;
    return <div className="space-y-5"><h1 className="text-3xl font-semibold">Racks — {data.month}</h1>{data.snapshot ? <><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Total Racks" value={metrics?.total} /><MetricCard label="In Use" value={metrics?.inUse?.count} /><MetricCard label="Available" value={metrics?.available?.count} /><MetricCard label="In Use" value={typeof metrics?.inUse?.ratio === "number" ? metrics.inUse.ratio * 100 : null} unit="%" /></div><RackRecordsTable records={data.snapshot.records ?? []} /></> : <EmptyState />}</div>;
  }
  const snapshot = data.snapshot;
  const imageUrl: string | null = null;
  const imageError: string | null = data.image ? "Rack Unit Capacity images are deferred from the reduced Web scope." : null;
  return <div className="space-y-5"><h1 className="text-3xl font-semibold">Rack Unit Capacity — {data.month}</h1>{snapshot ? <><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Total U" value={snapshot.totalU} unit="U" /><MetricCard label="Used U" value={snapshot.usedU} unit="U" /><MetricCard label="Available U" value={snapshot.availableU} unit="U" /><MetricCard label="Usage" value={snapshot.usagePercent} unit="%" /></div><section className="panel space-y-2"><h2 className="font-semibold">Rack Unit Capacity Image</h2>{imageUrl ? <img src={imageUrl} alt="Rack Unit Capacity" className="max-h-[520px] w-full object-contain rounded-xl border border-slate-800 bg-slate-950" /> : imageError ? <p role="alert" className="text-sm text-rose-300">{imageError}</p> : data.image ? <p className="text-sm text-slate-400">Loading image…</p> : <p className="text-sm text-slate-400">No Rack Unit Capacity image was captured for this month. The Desktop image is not substituted from another month.</p>}{data.image && <p className="text-xs text-slate-500">Captured by {data.image.savedBy} · {data.image.width}×{data.image.height}px</p>}</section></> : <EmptyState />}</div>;
}

function ReadDataPage({ kind, siteId, month, refreshKey = 0, readOnly = false, onSaved }: { kind: "dashboard" | "energy" | "cost" | "electrical" | "racks" | "rack-units"; siteId: number; month: string; refreshKey?: number; readOnly?: boolean; onSaved?: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!siteId || (kind !== "dashboard" && !month)) { setData(null); return; }
    const endpoint = kind === "dashboard" ? `/dashboard?siteId=${siteId}${month ? `&month=${encodeURIComponent(month)}` : ""}` : `/${kind}?siteId=${siteId}&month=${encodeURIComponent(month)}`;
    setLoading(true); setError(null);
    void apiRequest<any>(endpoint).then(setData).catch(cause => setError(cause instanceof ApiError && cause.status === 404 ? "ช่วงเวลานี้ไม่อยู่ใน Global Display Period หรือยังไม่มีข้อมูล" : "ไม่สามารถโหลดข้อมูลจาก API ได้")).finally(() => setLoading(false));
  }, [kind, month, refreshKey, siteId]);
   if (loading) return <LoadingState />;
   if (error) return <section role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5">{error}</section>;
   if (!data) return <EmptyState />;
  if (kind === "racks") return <WebRackCapacitySurface data={data} readOnly={readOnly} refreshKey={refreshKey} onSaved={onSaved ?? (() => undefined)} />;
   if (kind === "rack-units") return <div className="space-y-5"><RackDetailPage data={data} kind={kind} /><WebRackUnitEditor data={data} readOnly={readOnly} onSaved={onSaved ?? (() => undefined)} /></div>;
   if (kind === "dashboard" || kind === "energy") return <div className="space-y-5"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">{kind === "dashboard" ? "Dashboard" : "Energy"}</p><h1 className="text-3xl font-semibold mt-2">{data.month ?? data.selectedMonth ?? month}</h1><p className="text-xs text-slate-500 mt-1">Formula: {data.formulaVersion ?? data.energy?.formulaVersion ?? "desktop-v2.3.1"}</p></div><CalculationCards calculation={(data.calculation ?? data.energy?.calculation) as Calculation} />{kind === "dashboard" && data.engineeringDashboard && <EngineeringDashboardDetails snapshot={data.engineeringDashboard} />}</div>;
  if (kind === "cost") { const derived = data.derived ?? {}; return <div className="space-y-5"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Cost</p><h1 className="text-3xl font-semibold mt-2">{data.month}</h1></div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Building Cost" value={data.building?.costThb} unit="THB" /><MetricCard label="Floor Cost" value={derived.floorElectricityCostThb} unit="THB" /><MetricCard label="Average Rate" value={derived.averageElectricityRateThbPerKwh} unit="THB/kWh" /><MetricCard label="Energy Share" value={derived.energySharePercent} unit="%" /></div></div>; }
  if (kind === "electrical") return <div className="space-y-5"><h1 className="text-3xl font-semibold">Electrical — {data.month}</h1><div className="grid md:grid-cols-3 gap-4"><article className="panel"><h2 className="font-semibold">UPS</h2><p className="text-2xl mt-3">{data.ups?.length ?? 0}</p><p className="text-xs text-slate-500">records</p></article><article className="panel"><h2 className="font-semibold">Air</h2><p className="text-sm mt-3 text-slate-300">{data.air ? "Available" : "No data"}</p></article><article className="panel"><h2 className="font-semibold">DC</h2><p className="text-2xl mt-3">{data.dc?.length ?? 0}</p><p className="text-xs text-slate-500">panels</p></article></div><details className="panel"><summary className="cursor-pointer font-semibold">Raw API output</summary><pre className="mt-3 overflow-auto text-xs text-slate-400">{JSON.stringify({ ups: data.ups, air: data.air, dc: data.dc }, null, 2)}</pre></details></div>;
  if (kind === "racks") { const metrics = data.snapshot?.metrics; return <div className="space-y-5"><h1 className="text-3xl font-semibold">Racks — {data.month}</h1>{data.snapshot ? <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Total Racks" value={metrics?.total} /><MetricCard label="In Use" value={metrics?.inUse?.count} /><MetricCard label="Available" value={metrics?.available?.count} /><MetricCard label="In Use" value={typeof metrics?.inUse?.ratio === "number" ? metrics.inUse.ratio * 100 : null} unit="%" /></div> : <EmptyState />}</div>; }
  const rackUnit = data.snapshot; return <div className="space-y-5"><h1 className="text-3xl font-semibold">Rack Unit Capacity — {data.month}</h1>{rackUnit ? <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Total U" value={rackUnit.totalU} unit="U" /><MetricCard label="Used U" value={rackUnit.usedU} unit="U" /><MetricCard label="Available U" value={rackUnit.availableU} unit="U" /><MetricCard label="Usage" value={rackUnit.usagePercent} unit="%" /></div> : <EmptyState />}</div>;
}

function SiteComparisonPage() {
  const [data, setData] = useState<any>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void apiRequest<any>("/site-comparison").then(setData).catch(() => setError("ไม่สามารถโหลด Site Comparison ได้")); }, []);
  if (error) return <section role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5">{error}</section>;
  if (!data) return <LoadingState />;
  if (!data.months?.length) return <EmptyState />;
  const chartData = data.months.map((month: string) => Object.fromEntries([
    ["month", month],
    ...data.sites.map((site: any) => [site.site.code, site.months.find((entry: any) => entry.month === month)?.metrics?.buildingEnergy ?? null])
  ]));
  const chartMinWidth = Math.max(640, data.months.length * 76);
  return <div className="space-y-5"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Site Comparison</p><h1 className="text-3xl font-semibold mt-2">{data.displayPeriod.startMonth} → {data.displayPeriod.endMonth}</h1><p className="text-xs text-slate-500 mt-1">เฉพาะเดือนที่ backend อนุญาตและมีข้อมูล</p></div><div className="overflow-x-auto overflow-y-hidden overscroll-x-contain panel"><div style={{ minWidth: chartMinWidth }} className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />{data.sites.map((site: any, index: number) => <Line key={site.site.id} type="monotone" dataKey={site.site.code} name={site.site.name} stroke={index % 2 === 0 ? "#60a5fa" : "#fb7185"} connectNulls={false} />)}</LineChart></ResponsiveContainer></div></div><div className="overflow-x-auto panel"><table className="min-w-[760px] w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-4">Site</th>{data.months.map((item: string) => <th key={item} className="py-2 px-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{data.sites.map((site: any) => <tr key={site.site.id}><td className="py-3 pr-4 font-semibold">{site.site.name}</td>{data.months.map((item: string) => <td key={item} className="py-3 px-3 text-slate-400">{site.months.find((entry: any) => entry.month === item)?.metrics?.buildingEnergy === null ? "—" : formatNumber(site.months.find((entry: any) => entry.month === item)?.metrics?.buildingEnergy)}</td>)}</tr>)}</tbody></table></div></div>;
}

interface IntegrityResponse { siteId: number; facility: string; displayPeriod: { startMonth: string; endMonth: string }; validatedAt: string; structureOk: boolean; monthCount: number; firstMonth: string | null; lastMonth: string | null; availableMonths: string[]; missingMonths: string[]; missingSections: Array<{ month: string; sections: string[] }>; duplicateMonths: string[]; invalidMonths: string[]; errors: string[]; warnings: string[]; scope: string; }

/* Legacy duplicate retained in history only; the active Integrity page is defined below.
function IntegrityPageLegacy({ siteId }: { siteId: number }) {
  const [report, setReport] = useState<IntegrityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true); setError(null);
    try { setReport(await apiRequest<IntegrityResponse>(`/integrity?siteId=${siteId}`)); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Integrity validation could not be completed."); }
    finally { setLoading(false); }
  }, [siteId]);
  useEffect(() => { void load(); }, [load]);
  const issueCount = (report?.errors.length ?? 0) + (report?.missingMonths.length ?? 0) + (report?.missingSections.length ?? 0);
  return <section className="space-y-5" data-testid="web-integrity-center"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Data Integrity Center</p><h1 className="text-3xl font-semibold mt-2">Web data health</h1><p className="text-sm text-slate-400 mt-2">Validated against the Postgres monthly-log projection and the effective Display Period.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 py-2 text-sm font-semibold"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Validate now</button></div>{error && <p role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5">{error}</p>}{loading && <LoadingState />}{!loading && report && <><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Structure" value={report.structureOk ? "Valid" : "Issues"} /><MetricCard label="Imported months" value={report.monthCount} /><MetricCard label="Findings" value={issueCount} /><MetricCard label="Scope" value="Postgres" /></div><section className={`rounded-2xl border p-5 ${issueCount === 0 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-amber-500/10 border-amber-500/30"}`}><div className="flex items-center gap-3">{issueCount === 0 ? <ShieldCheck className="w-6 h-6 text-emerald-300" /> : <ShieldAlert className="w-6 h-6 text-amber-300" />}<div><h2 className="font-semibold">{issueCount === 0 ? "No findings" : `${issueCount} finding group(s)`}</h2><p className="text-xs text-slate-400 mt-1">{report.facility} · {report.displayPeriod.startMonth} → {report.displayPeriod.endMonth} · validated {formatTimestamp(new Date(report.validatedAt))}</p></div></div></section><div className="grid lg:grid-cols-2 gap-5"><section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3"><h2 className="font-semibold">Missing months</h2>{report.missingMonths.length === 0 ? <p className="text-sm text-emerald-300">None in the effective past/current Display Period.</p> : <div className="flex flex-wrap gap-2">{report.missingMonths.map(month => <span key={month} className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-xs text-amber-200">{month}</span>)}</div>}{report.errors.map(message => <p key={message} className="text-xs text-rose-300">{message}</p>)}{report.warnings.map(message => <p key={message} className="text-xs text-amber-300">{message}</p>)}</section><section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3"><h2 className="font-semibold">Empty source sections</h2>{report.missingSections.length === 0 ? <p className="text-sm text-emerald-300">No empty core sections detected.</p> : report.missingSections.map(item => <p key={item.month} className="text-sm text-amber-200"><span className="font-mono">{item.month}</span>: {item.sections.join(", ")}</p>)}<p className="text-xs text-slate-500">Scope: {report.scope}. Workbook-level duplicate/device-ID inspection, filesystem backup/recovery, and Google Sheets sync are separate Desktop capabilities.</p></section></div></>}</section>;
}
*/

interface WebIntegrityResponseDraft {
  siteId: number;
  facility: string;
  displayPeriod: { startMonth: string; endMonth: string };
  validatedAt: string;
  structureOk: boolean;
  monthCount: number;
  firstMonth: string | null;
  lastMonth: string | null;
  availableMonths: string[];
  missingMonths: string[];
  missingSections: Array<{ month: string; sections: string[] }>;
  duplicateMonths: string[];
  invalidMonths: string[];
  errors: string[];
  warnings: string[];
  scope: string;
}

interface WorkbookIntegrityResponse {
  scope: "desktop-workbook-package";
  sourceFileName: string;
  sourceFileHash: string;
  validatedAt: string;
  structureOk: boolean;
  validation: { ok: boolean; errors: string[]; warnings: string[]; sheetNames: Record<string, string> };
  integrity: { duplicateKeys: unknown[]; missingMonths: unknown[]; missingDevices: unknown[]; unexpectedBlankRows: unknown[]; invalidIds: unknown[] };
  package: { hasVbaProject: boolean; pivotCacheCount: number; chartCount: number; drawingCount: number; imageCount: number };
}

function IntegrityPage({ siteId }: { siteId: number }) {
  const [report, setReport] = useState<WebIntegrityResponseDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [workbookReport, setWorkbookReport] = useState<WorkbookIntegrityResponse | null>(null);
  const [workbookBusy, setWorkbookBusy] = useState(false);
  const [workbookError, setWorkbookError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!siteId) { setReport(null); return; }
    setLoading(true); setError(null);
    void apiRequest<WebIntegrityResponseDraft>(`/integrity?siteId=${siteId}`).then(setReport).catch(cause => setError(cause instanceof ApiError ? cause.message : "Integrity validation could not be loaded.")).finally(() => setLoading(false));
  }, [siteId]);
  useEffect(() => { load(); }, [load]);
  const inspectWorkbook = useCallback(async () => {
    if (!workbookFile || workbookBusy) return;
    if (workbookFile.size > 10 * 1024 * 1024) { setWorkbookError("Workbook exceeds the 10 MB inspection limit."); return; }
    setWorkbookBusy(true); setWorkbookError(null); setWorkbookReport(null);
    try {
      const contentBase64 = encodeBase64(await workbookFile.arrayBuffer());
      setWorkbookReport(await apiRequest<WorkbookIntegrityResponse>("/integrity/workbook", { method: "POST", body: JSON.stringify({ file_name: workbookFile.name, content_base64: contentBase64 }) }));
    } catch (cause) { setWorkbookError(cause instanceof ApiError ? cause.message : "Workbook inspection could not be completed."); }
    finally { setWorkbookBusy(false); }
  }, [workbookBusy, workbookFile]);
  if (loading) return <LoadingState />;
  if (error) return <section role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5">{error}</section>;
  if (!report) return <EmptyState message="Select a site to validate data integrity." />;
  const blockingCount = report.errors.length + report.invalidMonths.length + report.duplicateMonths.length;
  const healthy = report.structureOk && blockingCount === 0;
  return <section className="max-w-5xl space-y-5" data-testid="web-integrity-center">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Data Integrity Center</p><h1 className="text-3xl font-semibold mt-2">{report.facility}</h1><p className="text-xs text-slate-500 mt-1">Validated {formatTimestamp(new Date(report.validatedAt))} · Display Period {report.displayPeriod.startMonth} → {report.displayPeriod.endMonth}</p></div><button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm font-semibold"><RefreshCw className="w-4 h-4" /> Validate now</button></div>
    <div className={`rounded-2xl border p-4 flex items-center gap-3 ${healthy ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200" : "bg-amber-500/10 border-amber-500/30 text-amber-200"}`}><ShieldCheck className="w-6 h-6" /><div><p className="font-semibold">{healthy ? "No blocking integrity findings" : "Integrity findings require review"}</p><p className="text-xs opacity-80 mt-1">Scope: {report.scope}</p></div></div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Available months" value={report.monthCount} /><MetricCard label="Missing months" value={report.missingMonths.length} /><MetricCard label="Empty sections" value={report.missingSections.length} /><MetricCard label="Blocking findings" value={blockingCount} /></div>
    {(report.errors.length > 0 || report.warnings.length > 0) && <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2"><h2 className="font-semibold">Findings</h2>{[...report.errors, ...report.warnings].map((finding, index) => <p key={`${finding}-${index}`} className={`text-sm ${index < report.errors.length ? "text-rose-300" : "text-amber-300"}`}>{finding}</p>)}</section>}
    {report.missingSections.length > 0 && <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5"><h2 className="font-semibold mb-3">Months with empty source sections</h2><div className="overflow-x-auto"><table className="min-w-[420px] w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-4">Month</th><th className="py-2">Sections</th></tr></thead><tbody className="divide-y divide-slate-800">{report.missingSections.map(item => <tr key={item.month}><td className="py-2 pr-4 font-mono">{item.month}</td><td className="py-2 text-amber-300">{item.sections.join(", ")}</td></tr>)}</tbody></table></div></section>}
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3"><div><h2 className="font-semibold">Desktop workbook inspection</h2><p className="text-xs text-slate-500 mt-1">Runs the v2.3.1 workbook reader against the uploaded OOXML package, including duplicate keys, missing devices, invalid IDs and VBA/pivot/chart/image package evidence.</p></div><div className="flex flex-wrap items-center gap-3"><input type="file" accept=".xlsx,.xlsm" onChange={event => { setWorkbookFile(event.target.files?.[0] ?? null); setWorkbookReport(null); }} className="block w-full max-w-xl text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2.5 file:font-semibold file:text-white" /><button type="button" disabled={!workbookFile || workbookBusy} onClick={() => void inspectWorkbook()} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-3 py-2.5 text-sm font-semibold">{workbookBusy ? "Inspecting…" : "Inspect workbook"}</button></div>{workbookError && <p role="alert" className="text-sm text-rose-300">{workbookError}</p>}{workbookReport && <div className={`rounded-xl border p-4 space-y-2 ${workbookReport.structureOk && workbookReport.integrity.duplicateKeys.length === 0 && workbookReport.integrity.invalidIds.length === 0 ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"}`}><p className="font-semibold">{workbookReport.structureOk ? "Workbook structure valid" : "Workbook structure requires review"}</p><p className="text-xs text-slate-400 break-all">{workbookReport.sourceFileName} · SHA-256 {workbookReport.sourceFileHash}</p><p className="text-xs text-slate-300">Duplicates {workbookReport.integrity.duplicateKeys.length} · Missing devices {workbookReport.integrity.missingDevices.length} · Invalid IDs {workbookReport.integrity.invalidIds.length} · Blank rows {workbookReport.integrity.unexpectedBlankRows.length}</p><p className="text-xs text-slate-400">VBA {workbookReport.package.hasVbaProject ? "present" : "absent"} · Pivot caches {workbookReport.package.pivotCacheCount} · Charts {workbookReport.package.chartCount} · Images {workbookReport.package.imageCount}</p></div>}</section>
  </section>;
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
}

interface WorkbookImportResponse { sourceFileName: string; sourceFileHash: string; importedMonths: string[]; rackCapacitySnapshotMonth: string | null; rackUnitCapacityMonths: string[]; idempotent: boolean; validation: { warnings: string[] }; integrity: { duplicateKeys: unknown[]; missingMonths: unknown[]; missingDevices: unknown[]; unexpectedBlankRows: unknown[]; invalidIds: unknown[] }; }

function WorkbookImportPage({ siteId, readOnly }: { siteId: number; readOnly: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkbookImportResponse | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !siteId || busy || readOnly) return;
    if (file.size > 10 * 1024 * 1024) { setError("Workbook exceeds the 10 MB upload limit."); return; }
    setBusy(true); setError(null); setResult(null);
    try {
      const contentBase64 = encodeBase64(await file.arrayBuffer());
      setResult(await apiRequest<WorkbookImportResponse>(`/sites/${siteId}/import-workbook`, { method: "POST", body: JSON.stringify({ file_name: file.name, content_base64: contentBase64 }) }));
      setFile(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) setError("Workbook import is restricted to administrators.");
      else if (cause instanceof ApiError && cause.status === 423) setError("READ_ONLY_MODE: workbook import is disabled.");
      else setError(cause instanceof ApiError ? cause.message : "The workbook could not be imported.");
    } finally { setBusy(false); }
  };
  return <section className="max-w-4xl space-y-5" data-testid="web-workbook-import"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Data Management</p><h1 className="text-3xl font-semibold mt-2">Import Desktop Workbook</h1><p className="text-sm text-slate-400 mt-2">Upload a v2.3.1-compatible .xlsx or .xlsm workbook. The server validates it with the Desktop reader and commits all months atomically.</p></div>{readOnly && <p className="text-sm text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">READ_ONLY_MODE: workbook import is disabled.</p>}{error && <p role="alert" className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>}<form onSubmit={submit} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"><label className="block text-sm text-slate-300 font-semibold">Workbook file<input type="file" accept=".xlsx,.xlsm" onChange={event => setFile(event.target.files?.[0] ?? null)} disabled={busy || readOnly} className="mt-2 block w-full text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-2.5 file:font-semibold file:text-white" /></label><p className="text-xs text-slate-500">Maximum 10 MB. Existing monthly rows are updated with optimistic concurrency inside one database transaction; a validation or save failure rolls back the entire import.</p><button type="submit" disabled={!file || busy || readOnly} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold"><Upload className="w-4 h-4" />{busy ? "Importing…" : "Validate and Import"}</button></form>{result && <section role="status" className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-5 space-y-2"><h2 className="font-semibold text-emerald-200">{result.idempotent ? "Already imported — no changes made" : "Import completed"}</h2><p className="text-sm text-slate-300">{result.sourceFileName} · {result.importedMonths.length} monthly month(s)</p>{result.rackCapacitySnapshotMonth && <p className="text-xs text-slate-400">Rack Capacity snapshot: {result.rackCapacitySnapshotMonth}</p>}{result.rackUnitCapacityMonths.length > 0 && <p className="text-xs text-slate-400">Rack Unit Capacity snapshots: {result.rackUnitCapacityMonths.join(", ")}</p>}<p className="text-xs text-slate-500 break-all">SHA-256: {result.sourceFileHash}</p>{result.validation.warnings.length > 0 && <p className="text-xs text-amber-300">Warnings: {result.validation.warnings.length}</p>}<p className="text-xs text-slate-400">Integrity findings: {result.integrity.duplicateKeys.length} duplicates, {result.integrity.missingDevices.length} missing devices, {result.integrity.invalidIds.length} invalid IDs.</p></section>}</section>;
}

/* Legacy compact report page retained in history; the active page below uses
 * the Desktop ReportingCenter component and the same report API contract.
interface WebReportResponse { filename: string; month: string; facility: string; formulaVersion: string; status: "Complete" | "Partial" | "Validation warning"; html: string; }

function ReportPage({ siteId, month }: { siteId: number; month: string }) {
  const [report, setReport] = useState<WebReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    if (!siteId || !month) { setReport(null); return; }
    setLoading(true); setError(null);
    void apiRequest<WebReportResponse>(`/reports/all?siteId=${siteId}&month=${encodeURIComponent(month)}`)
      .then(setReport)
      .catch(cause => setError(cause instanceof ApiError && cause.status === 404 ? "The selected month has no reportable data." : "The report could not be generated."))
      .finally(() => setLoading(false));
  }, [month, siteId]);
  const download = useCallback(() => {
    if (!report) return;
    const blob = new Blob([report.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${report.filename}.html`; anchor.click();
    URL.revokeObjectURL(url);
  }, [report]);
  const print = useCallback(() => {
    if (!report) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) return;
    printWindow.document.write(report.html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [report]);
  const downloadExcel = useCallback(async () => {
    if (!report || !siteId || exporting) return;
    setExporting(true); setError(null);
    try {
      const source = await apiRequest<{ facility: string; logs: any[] }>(`/sites/${siteId}/export-data`);
      const blob = await buildWebWorkbook(source.logs, source.facility);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${report.filename}.xlsx`; anchor.click(); URL.revokeObjectURL(url);
    } catch { setError("The Excel workbook could not be exported."); } finally { setExporting(false); }
  }, [exporting, month, report, siteId]);
  return <section className="space-y-5" data-testid="web-reporting-center">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Reporting Center</p><h1 className="text-3xl font-semibold mt-2">Reports &amp; Export</h1><p className="text-sm text-slate-400 mt-2">Desktop-compatible report renderer backed by the authoritative Web API.</p></div>{report && <div className="flex flex-wrap gap-2"><button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-sm font-semibold"><FileDown className="w-4 h-4" /> Download HTML</button><button type="button" onClick={downloadExcel} disabled={exporting} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-2 text-sm font-semibold"><FileText className="w-4 h-4" /> {exporting ? "Exporting…" : "Download Excel"}</button><button type="button" onClick={print} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm font-semibold"><Printer className="w-4 h-4" /> Print / PDF</button></div>}</div>
    {loading && <LoadingState />}
    {error && <section role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5">{error}</section>}
    {!loading && !error && report && <><div className="flex flex-wrap gap-3 text-xs text-slate-400"><span>Facility: {report.facility}</span><span>Month: {report.month}</span><span>Formula: {report.formulaVersion}</span><span className={report.status === "Complete" ? "text-emerald-300" : "text-amber-300"}>Status: {report.status}</span></div><div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 overflow-auto"><iframe title="Desktop-compatible report preview" sandbox="" srcDoc={report.html} className="min-w-[900px] w-full h-[820px] rounded-sm bg-white" /></div></>}
    {!loading && !error && !report && <EmptyState message="Select a site and month to prepare the report." />}
  </section>;
}

*/

function downloadWebFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface ActiveWebReportResponse { filename: string; month: string; facility: string; formulaVersion: string; status: "Complete" | "Partial" | "Validation warning"; historicalStart: string | null; historicalEnd: string | null; html: string; }

function ReportPage({ siteId, facility, availableMonths, initialMonth }: { siteId: number; facility: string; availableMonths: string[]; initialMonth: string }) {
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"ready" | "generating" | "error">("generating");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async (request: ReportPreviewRequest) => {
    if (!siteId || !request.month) { setPreviewHtml(null); setPreviewStatus("error"); setPreviewError("Select an available reporting month."); return; }
    setPreviewStatus("generating"); setPreviewError(null); setError(null);
    try {
      const query = new URLSearchParams({ siteId: String(siteId), month: request.month, period: request.period, from: request.from, to: request.to, sections: request.sections.join(",") });
      const report = await apiRequest<ActiveWebReportResponse>(`/reports/all?${query.toString()}`);
      setPreviewHtml(report.html); setPreviewStatus("ready");
    } catch (cause) {
      setPreviewHtml(null); setPreviewStatus("error"); setPreviewError(cause instanceof ApiError ? cause.message : "The report could not be generated.");
    }
  }, [siteId]);

  const generateReport = useCallback(async (request: ReportRequest): Promise<{ filename: string } | null> => {
    try {
      const query = new URLSearchParams({ siteId: String(siteId), month: request.month, period: request.period, from: request.from, to: request.to, sections: request.sections.join(",") });
      const report = await apiRequest<ActiveWebReportResponse>(`/reports/all?${query.toString()}`);
      if (request.format === "excel") {
        const source = await apiRequest<{ facility: string; logs: any[]; rackCapacitySnapshots?: any[]; rackUnitCapacitySnapshots?: any[] }>(`/sites/${siteId}/export-data`);
        downloadWebFile(await buildWebWorkbook(source.logs, source.facility, source.rackCapacitySnapshots ?? [], source.rackUnitCapacitySnapshots ?? []), `${request.filename}.xlsx`);
      } else if (request.format === "csv") {
        const source = await apiRequest<{ logs: any[] }>(`/sites/${siteId}/export-data`);
        downloadWebFile(new Blob([buildCombinedCsv(source.logs)], { type: "text/csv;charset=utf-8" }), `${request.filename}.csv`);
      } else if (request.format === "pdf") {
        const artifact = await apiDownload(`/reports/all/export?${query.toString()}&format=pdf`);
        downloadWebFile(artifact, `${request.filename}.pdf`);
      }
      return { filename: request.filename };
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "Report export failed.");
      return null;
    }
  }, [siteId]);

  return <div className="space-y-3">{error && <section role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-4 text-sm">{error}</section>}<ReportingCenter facility={facility} availableMonths={availableMonths} initialMonth={initialMonth} previewHtml={previewHtml} previewStatus={previewStatus} previewError={previewError} onPreview={loadReport} onGenerate={generateReport} /></div>;
}

export default function WebV3App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const initialPath = window.location.pathname.replace(/\/+$/, "") || "/dashboard";
  const [route, setRoute] = useState(initialPath === "/" ? "/dashboard" : initialPath);
  const [siteId, setSiteId] = useState(0);
  const [month, setMonth] = useState("");
  const [formDirty, setFormDirty] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const canLeaveForm = useCallback(() => !formDirty || window.confirm("มีการแก้ไข raw inputs ที่ยังไม่บันทึก ต้องการออกจากหน้านี้หรือไม่?"), [formDirty]);
  const navigate = useCallback((path: string) => { if (!canLeaveForm()) return; window.history.pushState({}, "", path); setRoute(path); setFormDirty(false); }, [canLeaveForm]);

  useEffect(() => { if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard"); const handler = () => setRoute(window.location.pathname.replace(/\/+$/, "") || "/dashboard"); window.addEventListener("popstate", handler); return () => window.removeEventListener("popstate", handler); }, []);
  useEffect(() => { void apiRequest<{ authenticated: boolean; user: SessionUser | null }>("/auth/session").then(result => setUser(result.authenticated ? result.user : null)).catch(() => setUser(null)); }, []);
  useEffect(() => { if (!user) { setBootstrap(null); return; } void apiRequest<BootstrapState>("/bootstrap").then(result => { setBootstrap(result); const first = result.sites[0]; setSiteId(current => current || first?.site.id || 0); setMonth(current => current || first?.latestAvailableMonth || result.latestAvailableMonth || ""); }).catch(() => setBootstrap(null)); }, [user]);
  const selectedSite = useMemo(() => bootstrap?.sites.find(item => item.site.id === siteId) ?? bootstrap?.sites[0], [bootstrap, siteId]);
  useEffect(() => { const available = selectedSite?.availableMonths ?? []; if (month && available.length > 0 && !available.includes(month)) setMonth(selectedSite?.latestAvailableMonth ?? bootstrap?.latestAvailableMonth ?? ""); }, [bootstrap, month, selectedSite]);
  const logout = async () => { try { await apiRequest("/auth/logout", { method: "POST" }); } finally { setUser(null); setBootstrap(null); } };
  if (!user) return <LoginView onAuthenticated={authenticatedUser => { window.history.replaceState({}, "", "/dashboard"); setRoute("/dashboard"); setUser(authenticatedUser); }} />;
  if (!bootstrap) return <LoadingState />;
  const reportRoute = route === "/reports";
  const historyRoute = route === "/history";
  const needsScope = ["/dashboard", "/energy", "/cost", "/electrical", "/racks", "/rack-units"].includes(route);
  const selectedKind = (route.slice(1) || "dashboard") as "dashboard" | "energy" | "cost" | "electrical" | "racks" | "rack-units";
  const editableRoute = ["/energy", "/electrical", "/cost"].includes(route);
  if (reportRoute) return <Shell user={user} bootstrap={bootstrap} route={route} onNavigate={navigate} onLogout={logout}><ScopeBar bootstrap={bootstrap} siteId={siteId} month={month} onSiteChange={id => { if (!canLeaveForm()) return; setSiteId(id); const next = bootstrap.sites.find(item => item.site.id === id)?.latestAvailableMonth; if (next) setMonth(next); setFormDirty(false); }} onMonthChange={nextMonth => { if (!canLeaveForm()) return; setMonth(nextMonth); setFormDirty(false); }} /><div className="mt-5"><ReportPage siteId={selectedSite?.site.id ?? siteId} facility={selectedSite?.site.name ?? "Facility"} availableMonths={selectedSite?.availableMonths ?? []} initialMonth={month} /></div></Shell>;
  if (historyRoute) return <Shell user={user} bootstrap={bootstrap} route={route} onNavigate={navigate} onLogout={logout}><ScopeBar bootstrap={bootstrap} siteId={siteId} month={month} onSiteChange={id => { if (!canLeaveForm()) return; setSiteId(id); const next = bootstrap.sites.find(item => item.site.id === id)?.latestAvailableMonth; if (next) setMonth(next); setFormDirty(false); }} onMonthChange={() => undefined} /><div className="mt-5"><WebHistoricalPage siteId={selectedSite?.site.id ?? siteId} onEditMonth={nextMonth => { setMonth(nextMonth); navigate("/energy"); }} /></div></Shell>;
  return <Shell user={user} bootstrap={bootstrap} route={route} onNavigate={navigate} onLogout={logout}>{needsScope && <ScopeBar bootstrap={bootstrap} siteId={siteId} month={month} onSiteChange={id => { if (!canLeaveForm()) return; setSiteId(id); const next = bootstrap.sites.find(item => item.site.id === id)?.latestAvailableMonth; if (next) setMonth(next); setFormDirty(false); }} onMonthChange={nextMonth => { if (!canLeaveForm()) return; setMonth(nextMonth); setFormDirty(false); }} />}{needsScope && <div className="mt-5"><ReadDataPage kind={selectedKind} siteId={selectedSite?.site.id ?? siteId} month={month} refreshKey={refreshKey} readOnly={Boolean(bootstrap.readOnlyMode)} onSaved={() => setRefreshKey(value => value + 1)} />{editableRoute && <StructuredOperationalEditor siteId={selectedSite?.site.id ?? siteId} month={month} latestAvailableMonth={selectedSite?.latestAvailableMonth ?? bootstrap.latestAvailableMonth} readOnly={Boolean(bootstrap.readOnlyMode)} onDirty={setFormDirty} onSaved={() => setRefreshKey(value => value + 1)} />}</div>}{route === "/site-comparison" && <SiteComparisonPage />}{!needsScope && route !== "/site-comparison" && <EmptyState message="เลือกเมนูจากแถบด้านบน" />}</Shell>;
}
