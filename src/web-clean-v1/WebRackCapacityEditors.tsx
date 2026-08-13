import { useEffect, useMemo, useState } from "react";
import { Boxes, Save } from "lucide-react";
import type { IDataProvider, RackCapacitySaveOutcome, RackFieldChangeRequest } from "../data/IDataProvider";
import type { RackCapacitySummary } from "../reports/reportTypes";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import RackCapacityEditor from "../components/rack/RackCapacityEditor";
import { formatRatioPercent } from "../utils/rackCapacity";
import { api } from "./api";

export interface RackApiSnapshot {
  rowVersion: number;
  records: Array<{ rowNumber: number | null; rackZone: string | null; rackId: string | null; status: string | null; cabinetSize: string | null; detail: string | null; deviceType: string | null; remarks: string | null }>;
}

export interface RackUnitApiSnapshot { rowVersion: number; totalU: number; usedU: number; availableU: number; usagePercent: number | null; availabilityPercent: number | null; }

type ApiRackHistoryRow = { month: string; facility: string; rackZone: string; totalRacks: number; inUse: number; available: number; reserved: number; pendingDismantle: number; other: number; usagePct: number | null; availabilityPct: number | null; reservedPct: number | null; pendingDismantlePct: number | null; otherPct: number | null; generatedAt: string; dataVersion: number };

function summaryFromSnapshot(snapshot: RackApiSnapshot | null): RackCapacitySummary | null {
  if (!snapshot || snapshot.records.length === 0) return null;
  const countBy = (key: (record: RackApiSnapshot["records"][number]) => string | null) => {
    const counts = new Map<string, number>();
    for (const record of snapshot.records) { const value = key(record) ?? "(blank)"; counts.set(value, (counts.get(value) ?? 0) + 1); }
    return Array.from(counts, ([value, count]) => ({ key: value, count }));
  };
  return {
    totalRacks: snapshot.records.length,
    records: snapshot.records.map(record => ({ ...record, rowNumber: record.rowNumber ?? 0 })),
    byStatus: countBy(record => record.status).map(({ key, count }) => ({ status: key, count })),
    byZone: countBy(record => record.rackZone).map(({ key, count }) => ({ zone: key, count }))
  };
}

function historyRows(rows: ApiRackHistoryRow[]): RackCapacityHistoryRow[] {
  return rows.map(row => ({ snapshotMonth: row.month, facility: row.facility, rackZone: row.rackZone, totalRacks: row.totalRacks, inUse: row.inUse, available: row.available, reserved: row.reserved, pendingDismantle: row.pendingDismantle, other: row.other, usagePct: row.usagePct, availabilityPct: row.availabilityPct, reservedPct: row.reservedPct, pendingDismantlePct: row.pendingDismantlePct, otherPct: row.otherPct, generatedAt: row.generatedAt, dataVersion: row.dataVersion }));
}

/** Browser adapter for the Desktop Rack Capacity Editor. The Web endpoint
 * preserves the same field-level expected-value concurrency contract; it
 * deliberately does not expose a broad whole-snapshot overwrite. */
export function WebRackCapacityEditor({ siteId, month, onSaved }: { siteId: number; month: string; onSaved: (snapshot: RackApiSnapshot, history: RackCapacityHistoryRow[]) => void }) {
  const provider = useMemo(() => ({
    saveRackCapacity: async (changes: RackFieldChangeRequest[], snapshotMonth?: string | null, forceSnapshot?: boolean): Promise<RackCapacitySaveOutcome> => {
      const targetMonth = snapshotMonth ?? month;
      const result = await api<{ snapshot: RackApiSnapshot; outcomes: RackCapacitySaveOutcome["outcomes"]; changedCount: number; rackCapacityHistory: ApiRackHistoryRow[] }>(`/racks?siteId=${siteId}&month=${targetMonth}`, { method: "PUT", body: JSON.stringify({ changes, force_snapshot: forceSnapshot === true }) });
      const nextHistory = historyRows(result.rackCapacityHistory);
      onSaved(result.snapshot, nextHistory);
      return { savedAt: new Date().toISOString(), outcomes: result.outcomes, changedCount: result.changedCount, rackCapacity: summaryFromSnapshot(result.snapshot), rackCapacityHistory: nextHistory };
    }
  }) as unknown as IDataProvider, [siteId, month, onSaved]);
  return <RackCapacityEditor provider={provider} />;
}

/** Web equivalent of Desktop's Total/Used Rack Unit Capacity workflow.
 * It uses the selected global reporting month (instead of a second month
 * selector) and keeps an optimistic row version, so a stale browser cannot
 * overwrite another operator's saved capacity values. */
export function WebRackUnitCapacityEditor({ siteId, month, initialSnapshot, onSaved }: { siteId: number; month: string; initialSnapshot: RackUnitApiSnapshot | null; onSaved: (snapshot: RackUnitApiSnapshot) => void }) {
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
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load Rack Unit Capacity."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siteId, month]);

  const save = async (forceSnapshot: boolean) => {
    const total = Number(totalU); const used = Number(usedU);
    if (!Number.isFinite(total) || !Number.isFinite(used) || total < 0 || used < 0) { setError("Total (U) and Used (U) must be non-negative numbers."); return; }
    setSaving(true); setError(null);
    try {
      const result = await api<{ snapshot: RackUnitApiSnapshot }>(`/rack-unit-capacity?siteId=${siteId}&month=${month}`, { method: "PUT", body: JSON.stringify({ month, total_u: total, used_u: used, expected_row_version: snapshot?.rowVersion ?? null, force_snapshot: forceSnapshot }) });
      setSnapshot(result.snapshot); setTotalU(String(result.snapshot.totalU)); setUsedU(String(result.snapshot.usedU)); onSaved(result.snapshot);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save Rack Unit Capacity."); }
    finally { setSaving(false); }
  };

  const total = Number(totalU); const used = Number(usedU); const available = Number.isFinite(total) && Number.isFinite(used) ? total - used : null;
  return <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm space-y-4">
    <div className="flex items-start gap-3"><div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-400"><Boxes className="h-5 w-5" /></div><div><h3 className="text-base text-slate-100">Rack Unit Capacity</h3><p className="mt-1 text-xs text-slate-400">Record Total and Used rack units for {month}; Available and percentage values are derived.</p></div></div>
    {error && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><label className="text-xs text-slate-400">Total (U)<input disabled={loading || saving} type="number" min="0" value={totalU} onChange={event => setTotalU(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-60" /></label><label className="text-xs text-slate-400">Used (U)<input disabled={loading || saving} type="number" min="0" value={usedU} onChange={event => setUsedU(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-60" /></label><div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"><p className="text-[11px] text-slate-500">Available (U)</p><p className="mt-1 font-mono text-lg text-slate-100">{available ?? "—"}</p></div><div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"><p className="text-[11px] text-slate-500">Usage %</p><p className="mt-1 font-mono text-lg text-slate-100">{Number.isFinite(total) && total > 0 && Number.isFinite(used) ? formatRatioPercent(used / total) : "—"}</p></div></div>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={loading || saving} onClick={() => void save(false)} className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"><Save className="h-4 w-4" />{saving ? "Saving…" : "Save Rack Unit Capacity"}</button><button type="button" disabled={loading || saving} onClick={() => void save(true)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-60">Record monthly snapshot</button></div>
  </section>;
}
