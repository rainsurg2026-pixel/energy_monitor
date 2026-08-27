import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { ImagePlus, Save, Trash2 } from "lucide-react";
import { api } from "./api";
import { validateImageBytes } from "../utils/imageValidation";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { computeRackUnitCompletion, type SectionCompletion } from "../utils/completion";

interface RackUnitSnapshotResponse {
  snapshot: (RackUnitCapacityRow & { rowVersion: number; image: { available: boolean } | null }) | null;
}

interface Props {
  siteId: number;
  month: string;
  initialRow: RackUnitCapacityRow | null;
  onSaved: () => Promise<void> | void;
  onMessage: (message: string) => void;
  onCompletionChange?: (completion: SectionCompletion) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onRegisterActions?: (actions: RackUnitCapacityEntryActions | null) => void;
}

interface StagedImage { bytes: Uint8Array; previewUrl: string; contentType: "image/png" | "image/jpeg"; }
export interface RackUnitCapacityEntryActions {
  hasChanges: () => boolean;
  save: () => Promise<boolean>;
  reset: () => void;
}

function sameNumericValue(left: string, right: string): boolean {
  const leftText = left.trim();
  const rightText = right.trim();
  if (leftText === "" || rightText === "") return leftText === rightText;
  const leftNumber = Number(leftText);
  const rightNumber = Number(rightText);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) ? leftNumber === rightNumber : leftText === rightText;
}

export default function RackUnitCapacityEntry({ siteId, month, initialRow, onSaved, onMessage, onCompletionChange, onDirtyChange, onRegisterActions }: Props) {
  const [totalU, setTotalU] = useState(initialRow ? String(initialRow.totalU) : "");
  const [usedU, setUsedU] = useState(initialRow ? String(initialRow.usedU) : "");
  const [baselineTotalU, setBaselineTotalU] = useState(initialRow ? String(initialRow.totalU) : "");
  const [baselineUsedU, setBaselineUsedU] = useState(initialRow ? String(initialRow.usedU) : "");
  const [rowVersion, setRowVersion] = useState<number | null>(null);
  const [hasSavedImage, setHasSavedImage] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [stagedImage, setStagedImage] = useState<StagedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onCompletionChange?.(computeRackUnitCompletion(totalU, usedU));
  }, [onCompletionChange, totalU, usedU]);

  useEffect(() => {
    let cancelled = false;
    const initialTotal = initialRow ? String(initialRow.totalU) : "";
    const initialUsed = initialRow ? String(initialRow.usedU) : "";
    setTotalU(initialTotal);
    setUsedU(initialUsed);
    setBaselineTotalU(initialTotal);
    setBaselineUsedU(initialUsed);
    setRowVersion(null);
    setHasSavedImage(false);
    setImageLoadError(false);
    void api<RackUnitSnapshotResponse>(`/rack-unit-capacity?siteId=${siteId}&month=${encodeURIComponent(month)}`)
      .then(result => {
        if (cancelled) return;
        const row = result.snapshot;
        if (!row) return;
        setTotalU(String(row.totalU));
        setUsedU(String(row.usedU));
        setBaselineTotalU(String(row.totalU));
        setBaselineUsedU(String(row.usedU));
        setRowVersion(row.rowVersion);
        setHasSavedImage(Boolean(row.image?.available));
        setImageLoadError(false);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [siteId, month, initialRow?.totalU, initialRow?.usedU]);

  useEffect(() => () => { if (stagedImage) URL.revokeObjectURL(stagedImage.previewUrl); }, [stagedImage]);

  const hasChanges = !sameNumericValue(totalU, baselineTotalU) || !sameNumericValue(usedU, baselineUsedU) || stagedImage !== null;
  const hasChangesRef = useRef(false);
  hasChangesRef.current = hasChanges;

  const acceptImage = async (file: File) => {
    if (busy) return;
    setImageError(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validation = validateImageBytes(bytes);
    if (validation.ok === false) { setImageError("Only valid PNG or JPEG images up to 8 MB are supported."); return; }
    if (stagedImage) URL.revokeObjectURL(stagedImage.previewUrl);
    setStagedImage({ bytes, previewUrl: URL.createObjectURL(file), contentType: validation.image.mimeType });
  };

  const save = async (): Promise<boolean> => {
    if (busy) return false;
    const total = Number(totalU);
    const used = Number(usedU);
    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(used) || used < 0) { onMessage("Enter valid non-negative Total (U) and Used (U) values."); return false; }
    setBusy(true);
    try {
      const saved = await api<{ rowVersion: number }>(`/sites/${siteId}/rack-unit-capacity/${month}`, {
        method: "PUT",
        body: JSON.stringify({ total_u: total, used_u: used, expected_row_version: rowVersion })
      });
      setRowVersion(saved.rowVersion);
      setBaselineTotalU(String(total));
      setBaselineUsedU(String(used));
      if (stagedImage) {
        await api(`/sites/${siteId}/rack-unit-capacity/${month}/image`, {
          method: "PUT",
          headers: { "content-type": stagedImage.contentType },
          body: stagedImage.bytes as unknown as BodyInit
        });
        setHasSavedImage(true);
        URL.revokeObjectURL(stagedImage.previewUrl);
        setStagedImage(null);
        setImageError(null);
      }
      await onSaved();
      onMessage("Rack Unit Capacity and its monthly image were saved.");
      return true;
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Rack Unit Capacity could not be saved.");
      return false;
    } finally { setBusy(false); }
  };

  const removePending = () => {
    if (stagedImage) URL.revokeObjectURL(stagedImage.previewUrl);
    setStagedImage(null); setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const reset = () => {
    removePending();
    setTotalU(baselineTotalU);
    setUsedU(baselineUsedU);
    setImageError(null);
  };
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const resetRef = useRef<() => void>(() => undefined);
  saveRef.current = save;
  resetRef.current = reset;
  useEffect(() => { onDirtyChange?.(hasChanges); }, [hasChanges, onDirtyChange]);
  useEffect(() => {
    onRegisterActions?.({ hasChanges: () => hasChangesRef.current, save: () => saveRef.current(), reset: () => resetRef.current() });
    return () => onRegisterActions?.(null);
  }, [onRegisterActions]);

  const total = Number(totalU);
  const used = Number(usedU);
  const available = totalU.trim() === "" || usedU.trim() === "" ? null : total - used;
  const availability = available !== null && Number.isFinite(total) && total > 0 ? available / total : null;
  const imageUrl = `/api/v1/sites/${siteId}/rack-unit-capacity/${encodeURIComponent(month)}/image`;

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    let file: File | null = null;
    for (let index = 0; index < event.clipboardData.files.length; index += 1) {
      const candidate = event.clipboardData.files.item(index);
      if (candidate && (candidate.type === "image/png" || candidate.type === "image/jpeg")) { file = candidate; break; }
    }
    if (!file) return;
    event.preventDefault();
    void acceptImage(file);
  };

  return <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-sm">
    <div><h3 className="flex items-center gap-2 text-base text-slate-100"><ImagePlus className="h-5 w-5 text-emerald-400" />Rack Unit Capacity</h3><p className="mt-1 text-xs text-slate-400">Enter the monthly Rack Unit Capacity and attach the image for {month}. This is the final Data Entry section.</p></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
       <label className="text-xs text-slate-400">Total (U)<input type="number" min="0" value={totalU} disabled={busy} onChange={event => setTotalU(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 disabled:opacity-50" /></label>
       <label className="text-xs text-slate-400">Used (U)<input type="number" min="0" value={usedU} disabled={busy} onChange={event => setUsedU(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 disabled:opacity-50" /></label>
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><p className="text-[11px] text-slate-500">Available (U)</p><p className="mt-1 text-lg text-slate-100">{available === null ? "—" : available}</p></div>
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><p className="text-[11px] text-slate-500">Availability (%)</p><p className="mt-1 text-lg text-slate-100">{availability === null ? "—" : `${(availability * 100).toFixed(2)}%`}</p></div>
    </div>
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
       <div className="flex items-center justify-between"><h4 className="text-sm text-slate-200">Rack Unit Capacity Image</h4>{stagedImage && <button type="button" disabled={busy} onClick={removePending} className="inline-flex items-center gap-1 text-xs text-rose-400 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Remove pending image</button>}</div>
       <div tabIndex={busy ? -1 : 0} onPaste={handlePaste} onDragOver={event => { if (busy) return; event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={event => { if (busy) return; event.preventDefault(); setDragActive(false); const file = event.dataTransfer.files?.[0]; if (file) void acceptImage(file); }} className={`flex items-center gap-4 rounded-lg border-2 border-dashed p-4 focus:outline-none focus:ring-2 focus:ring-teal-500/50 ${dragActive ? "border-teal-400 bg-teal-500/5" : "border-slate-800"}`}>
         {stagedImage ? <img src={stagedImage.previewUrl} alt="Pending Rack Unit Capacity" className="h-24 w-auto max-w-[240px] rounded-md border border-slate-800 object-contain" /> : hasSavedImage && !imageLoadError ? <img src={imageUrl} alt={`Rack Unit Capacity ${month}`} onError={() => { setImageLoadError(true); setHasSavedImage(false); }} className="h-24 w-auto max-w-[240px] rounded-md border border-slate-800 object-contain" /> : <div className="flex h-24 w-24 items-center justify-center rounded-md border border-slate-800 text-slate-600"><ImagePlus className="h-8 w-8" /></div>}
         <div className="flex-1 space-y-1 text-xs text-slate-400"><p>Drop an image here, paste with Ctrl+V, or <button type="button" disabled={busy} onClick={() => fileInputRef.current?.click()} className="text-teal-400 underline underline-offset-2 disabled:opacity-50">choose a file</button></p><p className="text-slate-600">PNG or JPEG only, maximum 8 MB</p>{imageError && <p className="text-rose-400">{imageError}</p>}<input ref={fileInputRef} type="file" accept="image/png,image/jpeg" disabled={busy} className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void acceptImage(file); }} /></div>
      </div>
    </div>
    <div className="flex justify-end"><button type="button" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"><Save className="h-3.5 w-3.5" />{busy ? "Saving…" : "Save Rack Unit Capacity"}</button></div>
  </section>;
}
