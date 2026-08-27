import { useEffect, useMemo, useState } from "react";
import { Boxes, Check, Filter, RotateCcw, Save, Search } from "lucide-react";
import type { RackFieldChangeRequest } from "../data/IDataProvider";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import { formatRackCabinetSize, formatRatioPercent, normalizeRackEditableValue, RACK_CANONICAL_STATUSES, type RackEditableField } from "../utils/rackCapacity";
import { useRackCapacity } from "../components/rack/RackCapacityContext";
import { applyRackEditorPartialSave, applyRackEditorSaveFailure, applyRackEditorSaveSuccess, beginRackEditorSave, createRackEditorState, discardRackEditorChanges, rackEditorSourceKey, stageRackEditorField, type RackEditorRecord, type RackEditorState } from "./rackEditorState";
import { api } from "./api";

export interface RackApiSnapshot {
  month?: string;
  rowVersion: number;
  records: Array<{ rowNumber: number | null; rackZone: string | null; rackId: string | null; status: string | null; cabinetSize: string | null; detail: string | null; deviceType: string | null; remarks: string | null }>;
}

export interface RackUnitApiSnapshot { rowVersion: number; totalU: number; usedU: number; availableU: number; usagePercent: number | null; availabilityPercent: number | null; }

type ApiRackHistoryRow = { month: string; facility: string; rackZone: string; totalRacks: number; inUse: number; available: number; reserved: number; pendingDismantle: number; other: number; usagePct: number | null; availabilityPct: number | null; reservedPct: number | null; pendingDismantlePct: number | null; otherPct: number | null; generatedAt: string; dataVersion: number };

function historyRows(rows: ApiRackHistoryRow[]): RackCapacityHistoryRow[] {
  return rows.map(row => ({ snapshotMonth: row.month, facility: row.facility, rackZone: row.rackZone, totalRacks: row.totalRacks, inUse: row.inUse, available: row.available, reserved: row.reserved, pendingDismantle: row.pendingDismantle, other: row.other, usagePct: row.usagePct, availabilityPct: row.availabilityPct, reservedPct: row.reservedPct, pendingDismantlePct: row.pendingDismantlePct, otherPct: row.otherPct, generatedAt: row.generatedAt, dataVersion: row.dataVersion }));
}

type RackEditorField = RackEditableField;
const rackEditorFields: readonly RackEditorField[] = ["status", "cabinetSize", "detail", "deviceType", "remarks"];

function editorRecord(record: RackApiSnapshot["records"][number]): RackEditorRecord { return { ...record }; }
function editorRecords(snapshot: RackApiSnapshot | null): RackEditorRecord[] { return snapshot ? snapshot.records.map(editorRecord) : []; }
function fieldLabel(field: RackEditorField): string { return field === "cabinetSize" ? "Cabinet Size (cm)" : field === "deviceType" ? "Device Type" : field[0].toUpperCase() + field.slice(1); }
function displayField(field: RackEditorField, value: string | null): string { return field === "cabinetSize" ? formatRackCabinetSize(value) : value ?? ""; }
function valueForInput(field: RackEditorField, value: string | null): string { return field === "cabinetSize" ? (value ? formatRackCabinetSize(value) : "") : value ?? ""; }
function changeForRow(baseline: RackEditorRecord, current: RackEditorRecord): RackFieldChangeRequest {
  const change: RackFieldChangeRequest = { rowNumber: baseline.rowNumber!, rackId: baseline.rackId! };
  for (const field of rackEditorFields) {
    const expected = normalizeRackEditableValue(field, baseline[field]);
    const next = normalizeRackEditableValue(field, current[field]);
    if (expected === next) continue;
    if (field === "status") change.status = { expected, next: next ?? "" };
    else change[field] = { expected, next };
  }
  return change;
}

function mergePartialRackSave(state: RackEditorState, snapshot: RackApiSnapshot, outcomes: Array<{ rowNumber: number; applied: boolean }>): RackEditorState {
  const applied = new Set(outcomes.filter(outcome => outcome.applied).map(outcome => outcome.rowNumber));
  const next = applyRackEditorPartialSave(state, snapshot.records.map(editorRecord), snapshot.rowVersion, applied);
  return { ...next, error: applied.size === outcomes.length ? null : "Some rows changed on the server. Review the highlighted rows before saving again." };
}

/** Production-web Rack Capacity editor. It owns a server-confirmed baseline
 * and sends one optimistic, field-level batch per save. The Desktop editor is
 * intentionally left untouched because it uses a different IDataProvider. */
export function WebRackCapacityEditor({ siteId, month, snapshot, onSaved, onDirtyChange }: { siteId: number; month: string; snapshot: RackApiSnapshot | null; onSaved?: (snapshot: RackApiSnapshot, history: RackCapacityHistoryRow[]) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { selectedZone } = useRackCapacity();
  const [state, setState] = useState<RackEditorState | null>(() => snapshot ? createRackEditorState(siteId, month, snapshot.rowVersion, editorRecords(snapshot)) : null);
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState(selectedZone ?? "");
  const [statusFilter, setStatusFilter] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const stateSourceKey = state?.sourceKey ?? null;

  useEffect(() => {
    if (!snapshot) { setState(null); return; }
    const key = rackEditorSourceKey(siteId, month, snapshot.rowVersion);
    if (stateSourceKey !== key) setState(createRackEditorState(siteId, month, snapshot.rowVersion, editorRecords(snapshot)));
  }, [month, siteId, snapshot, stateSourceKey]);
  useEffect(() => { onDirtyChange?.((state?.dirtyRows.size ?? 0) > 0); }, [onDirtyChange, state?.dirtyRows.size]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => { if (selectedZone !== null) setZoneFilter(selectedZone); }, [selectedZone]);

  const visibleRecords = useMemo(() => {
    if (!state) return [];
    const needle = query.trim().toLowerCase();
    return state.current.filter(record => (!zoneFilter || record.rackZone === zoneFilter) && (!statusFilter || record.status === statusFilter) && (!needle || [record.rackZone, record.rackId, record.status, record.cabinetSize, record.detail, record.deviceType, record.remarks].some(value => value?.toLowerCase().includes(needle))));
  }, [query, state, statusFilter, zoneFilter]);
  const zones = useMemo(() => Array.from(new Set<string>((state?.current ?? []).map(record => record.rackZone).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b)), [state]);
  const statuses = useMemo(() => Array.from(new Set<string>((state?.current ?? []).map(record => record.status).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b)), [state]);

  if (!snapshot || !state) return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">Rack Capacity Editor is unavailable for this month because no monthly Rack Capacity snapshot exists.</section>;
  const dirtyCount = state.dirtyRows.size;
  const baselineByRow = new Map<number, RackEditorRecord>(state.baseline.flatMap(record => record.rowNumber === null ? [] : [[record.rowNumber, record] as const]));
  const save = async () => {
    if (dirtyCount === 0 || state.saving) return;
    const changes = state.current.filter(record => record.rowNumber !== null && state.dirtyRows.has(record.rowNumber)).map(record => changeForRow(baselineByRow.get(record.rowNumber!)!, record));
    setState(beginRackEditorSave(state));
    try {
      const result = await api<{ snapshot: RackApiSnapshot; outcomes: Array<{ rowNumber: number; applied: boolean }>; rackCapacityHistory: ApiRackHistoryRow[] }>(`/racks?siteId=${siteId}&month=${encodeURIComponent(month)}`, { method: "PUT", body: JSON.stringify({ changes, expected_row_version: snapshot.rowVersion, force_snapshot: true }) });
      const nextHistory = historyRows(result.rackCapacityHistory);
       setState(previous => previous ? (result.outcomes.every(outcome => outcome.applied) ? applyRackEditorSaveSuccess(previous, editorRecords(result.snapshot), result.snapshot.rowVersion) : mergePartialRackSave(previous, result.snapshot, result.outcomes)) : previous);
      onSaved?.(result.snapshot, nextHistory);
    } catch (reason) {
      setState(previous => previous ? applyRackEditorSaveFailure(previous, reason instanceof Error ? reason.message : "Rack Capacity save failed. Your edits remain available.") : previous);
    }
  };
  const discard = () => { if (dirtyCount > 0) setConfirmDiscard(true); };
  const confirm = () => { setState(previous => previous ? discardRackEditorChanges(previous) : previous); setConfirmDiscard(false); };
  const stage = (rowNumber: number, field: RackEditorField, value: string | null) => setState(previous => previous && !previous.saving ? stageRackEditorField(previous, rowNumber, field, value) : previous);
  return <section aria-busy={state.saving} className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
    <div className="border-b border-slate-800 bg-slate-950/60 px-5 py-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-300"><Boxes className="h-5 w-5" /></div><div><h3 className="font-display text-lg font-bold text-slate-100">Rack Capacity Editor</h3><p className="mt-1 text-xs text-slate-400">Review and update monthly rack status and supporting details for {month}.</p></div></div><div className="flex items-center gap-2 text-xs text-slate-400"><Check className="h-4 w-4 text-emerald-400" />Server-confirmed monthly snapshot</div></div>
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_180px_180px_auto]"><label className="relative block"><span className="sr-only">Search Rack ID</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Rack ID or detail" className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-600" /></label><label className="flex items-center gap-2"><span className="sr-only">Rack Zone</span><Filter className="h-4 w-4 shrink-0 text-slate-500" /><select value={zoneFilter} onChange={event => setZoneFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"><option value="">Rack Zone</option>{zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label><label><span className="sr-only">Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100"><option value="">Status</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select></label><div className="flex items-center justify-end gap-2"><button type="button" onClick={() => void save()} disabled={dirtyCount === 0 || state.saving} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold ${dirtyCount > 0 ? "bg-indigo-600 text-white hover:bg-indigo-500" : "bg-slate-700 text-slate-500"}`}><Save className="h-4 w-4" />{state.saving ? "Saving…" : dirtyCount === 1 ? "Save 1 Change" : `Save ${dirtyCount} Changes`}</button>{dirtyCount > 0 && <button type="button" onClick={discard} disabled={state.saving} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/50 px-3 py-2.5 text-sm text-rose-300 hover:bg-rose-500/10"><RotateCcw className="h-4 w-4" />Discard Changes</button>}</div></div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-slate-400">{dirtyCount > 0 ? `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}` : "No unsaved changes"}</span><span className="text-slate-500">Showing {visibleRecords.length} of {state.current.length} racks</span></div>
      {state.error && <p role="alert" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{state.error}</p>}
    </div>
    <div className="max-h-[620px] overflow-auto"><table className="min-w-[1050px] w-full border-collapse text-left text-xs"><thead className="sticky top-0 z-10 bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500"><tr>{["Zone", "Rack ID", "Status", "Cabinet Size (cm)", "Detail", "Device Type", "Remarks"].map(label => <th key={label} className="border-b border-slate-800 px-4 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{visibleRecords.map(record => { const dirty = record.rowNumber !== null && state.dirtyRows.has(record.rowNumber); return <tr key={`${record.rowNumber}-${record.rackId}`} className={dirty ? "bg-indigo-500/10" : "border-b border-slate-800/70"}><td className="px-4 py-2.5 font-medium text-slate-300">{record.rackZone ?? "—"}</td><td className="px-4 py-2.5 font-mono text-slate-100">{record.rackId ?? "—"}</td><td className="px-4 py-2.5"><select aria-label={`${record.rackId ?? "Rack"} Status`} value={valueForInput("status", record.status)} onChange={event => stage(record.rowNumber!, "status", event.target.value)} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100">{record.status && !RACK_CANONICAL_STATUSES.includes(record.status as (typeof RACK_CANONICAL_STATUSES)[number]) && <option value={record.status}>{record.status}</option>}{RACK_CANONICAL_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}</select></td>{rackEditorFields.slice(1).map(field => <td key={field} className="px-4 py-2.5"><input aria-label={`${record.rackId ?? "Rack"} ${fieldLabel(field)}`} value={valueForInput(field, record[field])} onChange={event => stage(record.rowNumber!, field, event.target.value)} placeholder={displayField(field, record[field]) || "—"} className="w-full min-w-[130px] rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 placeholder:text-slate-600" /></td>)}</tr>; })}</tbody></table></div>
    <div className="border-t border-slate-800 px-5 py-3 text-xs text-slate-500">Showing {visibleRecords.length} of {state.current.length} racks</div>
    {confirmDiscard && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 px-4"><section role="dialog" aria-modal="true" aria-labelledby="discard-rack-title" className="w-full max-w-sm rounded-2xl border border-amber-500/40 bg-slate-900 p-6 shadow-2xl"><p id="discard-rack-title" className="font-display text-lg font-bold text-slate-100">Discard {dirtyCount} unsaved changes? Your edits will be lost.</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setConfirmDiscard(false)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Cancel</button><button type="button" onClick={confirm} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white">Discard Changes</button></div></section></div>}
    {state.saving && <div className="absolute inset-0 z-20 cursor-wait bg-slate-950/20" aria-label="Saving Rack Capacity" />}
  </section>;
}

/** Web equivalent of Desktop's Total/Used Rack Unit Capacity workflow.
 * It uses the selected global reporting month (instead of a second month
 * selector) and keeps an optimistic row version, so a stale browser cannot
 * overwrite another operator's saved capacity values. */
export function WebRackUnitCapacityEditor({ siteId, month, initialSnapshot, onSaved, lang = "en" }: { siteId: number; month: string; initialSnapshot: RackUnitApiSnapshot | null; onSaved: (snapshot: RackUnitApiSnapshot) => void; lang?: "th" | "en" }) {
  const th = lang === "th";
  const copy = th ? {
    title: "ความจุหน่วยแร็ก",
    description: "บันทึกจำนวน U ทั้งหมดและ U ที่ใช้งานของเดือน {month}; ค่าคงเหลือและเปอร์เซ็นต์คำนวณอัตโนมัติ",
    total: "ทั้งหมด (U)",
    used: "ใช้งาน (U)",
    available: "คงเหลือ (U)",
    usage: "การใช้งาน %",
    invalid: "ค่า Total (U) และ Used (U) ต้องเป็นตัวเลขที่ไม่ติดลบ",
    loadingError: "ไม่สามารถโหลดความจุหน่วยแร็กได้",
    save: "บันทึกความจุหน่วยแร็ก",
    saving: "กำลังบันทึก…",
    snapshot: "บันทึก snapshot ประจำเดือน"
  } : {
    title: "Rack Unit Capacity",
    description: "Record Total and Used rack units for {month}; Available and percentage values are derived.",
    total: "Total (U)",
    used: "Used (U)",
    available: "Available (U)",
    usage: "Usage %",
    invalid: "Total (U) and Used (U) must be non-negative numbers.",
    loadingError: "Unable to load Rack Unit Capacity.",
    save: "Save Rack Unit Capacity",
    saving: "Saving…",
    snapshot: "Record monthly snapshot"
  };
  const [snapshot, setSnapshot] = useState<RackUnitApiSnapshot | null>(initialSnapshot);
  const [totalU, setTotalU] = useState("");
  const [usedU, setUsedU] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api<{ snapshot: RackUnitApiSnapshot | null }>(`/rack-unit-capacity?siteId=${siteId}&month=${month}`)
      .then(result => {
        if (cancelled) return;
        setSnapshot(result.snapshot);
        setTotalU(result.snapshot ? String(result.snapshot.totalU) : "");
        setUsedU(result.snapshot ? String(result.snapshot.usedU) : "");
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : copy.loadingError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siteId, month]);

  const save = async (forceSnapshot: boolean) => {
    const total = Number(totalU); const used = Number(usedU);
    if (!Number.isFinite(total) || !Number.isFinite(used) || total < 0 || used < 0) { setError(copy.invalid); return; }
    setSaving(true); setError(null);
    try {
      const result = await api<{ snapshot: RackUnitApiSnapshot }>(`/rack-unit-capacity?siteId=${siteId}&month=${month}`, { method: "PUT", body: JSON.stringify({ month, total_u: total, used_u: used, expected_row_version: snapshot?.rowVersion ?? null, force_snapshot: forceSnapshot }) });
      setSnapshot(result.snapshot); setTotalU(String(result.snapshot.totalU)); setUsedU(String(result.snapshot.usedU)); onSaved(result.snapshot);
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.loadingError); }
    finally { setSaving(false); }
  };

  const total = Number(totalU); const used = Number(usedU); const available = Number.isFinite(total) && Number.isFinite(used) ? total - used : null;
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm space-y-4">
    <div className="flex items-start gap-3"><div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-400"><Boxes className="h-5 w-5" /></div><div><h3 className="text-base text-slate-100">{copy.title}</h3><p className="mt-1 text-xs text-slate-400">{copy.description.replace("{month}", month)}</p></div></div>
    {error && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><label className="text-xs text-slate-400">{copy.total}<input disabled={loading || saving} type="number" min="0" value={totalU} onChange={event => setTotalU(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-60" /></label><label className="text-xs text-slate-400">{copy.used}<input disabled={loading || saving} type="number" min="0" value={usedU} onChange={event => setUsedU(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-60" /></label><div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"><p className="text-[11px] text-slate-500">{copy.available}</p><p className="mt-1 font-mono text-lg text-slate-100">{available ?? "—"}</p></div><div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"><p className="text-[11px] text-slate-500">{copy.usage}</p><p className="mt-1 font-mono text-lg text-slate-100">{Number.isFinite(total) && total > 0 && Number.isFinite(used) ? formatRatioPercent(used / total) : "—"}</p></div></div>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={loading || saving} onClick={() => void save(false)} className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"><Save className="h-4 w-4" />{saving ? copy.saving : copy.save}</button><button type="button" disabled={loading || saving} onClick={() => void save(true)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-60">{copy.snapshot}</button></div>
  </section>;
}
