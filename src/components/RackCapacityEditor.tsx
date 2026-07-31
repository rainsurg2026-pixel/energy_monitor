import { useEffect, useMemo, useRef, useState } from "react";
import type { RackCapacitySummary, RackRecord } from "../reports/reportTypes";
import type { IDataProvider } from "../data/IDataProvider";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import { RACK_CANONICAL_STATUSES } from "../utils/rackCapacity";
import { validateImageBytes } from "../utils/imageValidation";
import { notify } from "./Toast";
import { Search, X, Save, AlertTriangle, ImagePlus, Trash2 } from "lucide-react";

interface StagedImage {
  bytes: Uint8Array;
  previewUrl: string;
  width: number;
  height: number;
}

interface RackCapacityEditorProps {
  rackCapacity: RackCapacitySummary | null;
  provider: IDataProvider;
  lang: "th" | "en";
  /** Called with the freshly-saved snapshot (+ history) so the parent can
   *  refresh its own copy without a full workbook reload. */
  onSaved: (rackCapacity: RackCapacitySummary | null, rackCapacityHistory: RackCapacityHistoryRow[]) => void;
}

interface StagedChange {
  rackId: string;
  rackZone: string | null;
  expectedStatus: string | null;
  newStatus: string;
}

const STATUS_LABEL_TH: Record<string, string> = {
  "In Use": "ใช้งานอยู่",
  "Available": "ว่าง",
  "Reserved": "จองไว้",
  "Pending Dismantle": "รอถอดถอน"
};

export default function RackCapacityEditor({ rackCapacity, provider, lang, onSaved }: RackCapacityEditorProps) {
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [idQuery, setIdQuery] = useState<string>("");
  const [staged, setStaged] = useState<Map<number, StagedChange>>(new Map());
  const [saving, setSaving] = useState(false);
  const [stagedImage, setStagedImage] = useState<StagedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (stagedImage) URL.revokeObjectURL(stagedImage.previewUrl);
    };
  }, [stagedImage]);

  // Clipboard paste (Ctrl+V) anywhere on this page stages an image, same as
  // drag-drop/file-picker - matches the "paste an image straight in" workflow.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) void acceptImageFile(file);
          event.preventDefault();
          return;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acceptImageFile = async (file: File) => {
    setImageError(null);
    const buffer = new Uint8Array(await file.arrayBuffer());
    const result = validateImageBytes(buffer);
    if (result.ok === false) {
      const reason = lang === "th"
        ? { empty_file: "ไฟล์ว่างเปล่า", too_large: "ไฟล์มีขนาดใหญ่เกินไป (สูงสุด 8MB)", corrupt_png: "ไฟล์ PNG เสียหาย", corrupt_jpeg: "ไฟล์ JPEG เสียหาย", unsupported_format: "รองรับเฉพาะไฟล์ PNG หรือ JPEG เท่านั้น" }[result.reason]
        : { empty_file: "The file is empty.", too_large: "The file is too large (max 8MB).", corrupt_png: "This PNG file is corrupt.", corrupt_jpeg: "This JPEG file is corrupt.", unsupported_format: "Only PNG or JPEG images are supported." }[result.reason];
      setImageError(reason ?? (lang === "th" ? "ไฟล์รูปภาพไม่ถูกต้อง" : "Invalid image file."));
      return;
    }
    if (stagedImage) URL.revokeObjectURL(stagedImage.previewUrl);
    setStagedImage({ bytes: buffer, previewUrl: URL.createObjectURL(file), width: result.image.width, height: result.image.height });
  };

  const removeStagedImage = () => {
    if (stagedImage) URL.revokeObjectURL(stagedImage.previewUrl);
    setStagedImage(null);
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const records = rackCapacity?.records ?? [];

  const zoneOptions = useMemo(
    () => Array.from(new Set(records.map(r => r.rackZone).filter((z): z is string => Boolean(z)))).sort((a, b) => a.localeCompare(b)),
    [records]
  );

  const filteredRecords = useMemo(() => {
    const query = idQuery.trim().toLowerCase();
    return records.filter(record => {
      if (zoneFilter && (record.rackZone ?? "") !== zoneFilter) return false;
      if (statusFilter && (record.status ?? "") !== statusFilter) return false;
      if (query && !(record.rackId ?? "").toLowerCase().includes(query)) return false;
      return true;
    });
  }, [records, zoneFilter, statusFilter, idQuery]);

  const hasFilters = Boolean(zoneFilter || statusFilter || idQuery);
  const clearFilters = () => {
    setZoneFilter("");
    setStatusFilter("");
    setIdQuery("");
  };

  const statusLabel = (status: string): string => (lang === "th" ? STATUS_LABEL_TH[status] ?? status : status);

  const stageChange = (record: RackRecord, newStatus: string) => {
    setStaged(prev => {
      const next = new Map(prev);
      if (newStatus === (record.status ?? "")) {
        // Reverted back to the original value - no longer a pending change.
        next.delete(record.rowNumber);
      } else {
        next.set(record.rowNumber, { rackId: record.rackId ?? "", rackZone: record.rackZone, expectedStatus: record.status, newStatus });
      }
      return next;
    });
  };

  const discardChanges = () => setStaged(new Map());

  const hasPendingWork = staged.size > 0 || stagedImage !== null;

  const saveChanges = async () => {
    if (!hasPendingWork || !provider.saveRackCapacity) return;
    setSaving(true);
    try {
      const changes = Array.from(staged.entries()).map(([rowNumber, change]) => ({
        rowNumber,
        rackId: change.rackId,
        expectedStatus: change.expectedStatus,
        newStatus: change.newStatus
      }));
      const result = await provider.saveRackCapacity(changes, stagedImage ? { bytes: stagedImage.bytes } : null);
      const conflicts = result.outcomes.filter(o => !o.applied);
      const parts: string[] = [];
      if (result.changedCount > 0) {
        parts.push(lang === "th" ? `การเปลี่ยนแปลง ${result.changedCount} รายการ` : `${result.changedCount} status change${result.changedCount === 1 ? "" : "s"}`);
      }
      if (result.imageEmbedded) parts.push(lang === "th" ? "รูปภาพ" : "image");
      if (conflicts.length === 0) {
        notify("success", parts.length > 0
          ? (lang === "th" ? `บันทึก${parts.join(" และ ")}แล้ว` : `Saved ${parts.join(" and ")}.`)
          : (lang === "th" ? "ไม่มีการเปลี่ยนแปลง" : "Nothing to save."));
        setStaged(new Map());
        removeStagedImage();
      } else {
        // Keep only the still-conflicting rows staged; applied ones (and any
        // saved image) are done.
        setStaged(prev => {
          const next = new Map(prev);
          for (const outcome of result.outcomes) if (outcome.applied) next.delete(outcome.rowNumber);
          return next;
        });
        if (result.imageEmbedded) removeStagedImage();
        notify("error", lang === "th"
          ? `${conflicts.length} รายการมีการเปลี่ยนแปลงจากที่อื่นแล้ว กรุณาโหลดใหม่และลองอีกครั้ง`
          : `${conflicts.length} change${conflicts.length === 1 ? "" : "s"} conflicted with a newer value on disk - reload and retry those rows.`);
      }
      onSaved(result.rackCapacity, result.rackCapacityHistory);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!rackCapacity) {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <p className="text-sm text-slate-500">
          {lang === "th" ? "ไม่พบ Rack Capacity / Table7 ใน Workbook ปัจจุบัน" : "Rack Capacity / Table7 is unavailable in the current workbook."}
        </p>
      </section>
    );
  }

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base text-slate-100">{lang === "th" ? "แก้ไขความจุแร็ค" : "Rack Capacity Editor"}</h3>
          <p className="text-xs text-slate-400 mt-1">
            {lang === "th" ? "ค้นหาแร็คและเปลี่ยนสถานะ การเปลี่ยนแปลงจะยังไม่บันทึกจนกว่าจะกดบันทึก" : "Find a rack and change its status. Changes are staged until you save."}
          </p>
        </div>
        {hasPendingWork && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {lang === "th"
              ? `การเปลี่ยนแปลงที่ยังไม่บันทึก ${staged.size}${stagedImage ? " + รูปภาพ" : ""} รายการ`
              : `${staged.size} unsaved change${staged.size === 1 ? "" : "s"}${stagedImage ? " + 1 image" : ""}`}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm text-slate-200">{lang === "th" ? "รูปภาพความจุแร็ค (K9)" : "Rack Capacity Image (K9)"}</h4>
          {stagedImage && (
            <button type="button" onClick={removeStagedImage} className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300">
              <Trash2 className="w-3.5 h-3.5" />{lang === "th" ? "ลบรูปที่รอบันทึก" : "Remove pending image"}
            </button>
          )}
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={e => {
            e.preventDefault();
            setDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void acceptImageFile(file);
          }}
          className={`rounded-lg border-2 border-dashed p-4 flex items-center gap-4 transition-colors ${dragActive ? "border-indigo-400 bg-indigo-500/5" : "border-slate-800"}`}
        >
          {stagedImage ? (
            <img src={stagedImage.previewUrl} alt="Rack Capacity preview" className="h-24 w-auto max-w-[240px] object-contain rounded-md border border-slate-800" />
          ) : (
            <div className="h-24 w-24 flex items-center justify-center rounded-md border border-slate-800 text-slate-600">
              <ImagePlus className="w-8 h-8" />
            </div>
          )}
          <div className="flex-1 text-xs text-slate-400 space-y-1">
            <p>
              {lang === "th" ? "ลากรูปมาวางที่นี่ วางด้วย Ctrl+V หรือ " : "Drop an image here, paste with Ctrl+V, or "}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
                {lang === "th" ? "เลือกไฟล์" : "choose a file"}
              </button>
            </p>
            <p className="text-slate-600">{lang === "th" ? "รองรับ PNG และ JPEG เท่านั้น" : "PNG or JPEG only"}</p>
            {imageError && <p className="text-rose-400">{imageError}</p>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) void acceptImageFile(file);
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "โซนแร็ค" : "Rack Zone"}</label>
          <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="">{lang === "th" ? "ทุกโซน" : "All zones"}</option>
            {zoneOptions.map(zone => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "รหัสแร็ค" : "Rack ID"}</label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={idQuery}
              onChange={e => setIdQuery(e.target.value)}
              placeholder={lang === "th" ? "ค้นหา เช่น AA01" : "Search, e.g. AA01"}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "สถานะ" : "Status"}</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="">{lang === "th" ? "ทุกสถานะ" : "All statuses"}</option>
            {RACK_CANONICAL_STATUSES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-500">
          {lang === "th" ? `พบ ${filteredRecords.length} จากทั้งหมด ${records.length} แร็ค` : `${filteredRecords.length} of ${records.length} racks`}
        </p>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
              <X className="w-3.5 h-3.5" />{lang === "th" ? "ล้างตัวกรอง" : "Clear Filters"}
            </button>
          )}
          {hasPendingWork && (
            <button
              type="button"
              onClick={() => { discardChanges(); removeStagedImage(); }}
              disabled={saving}
              className="text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              {lang === "th" ? "ยกเลิกการเปลี่ยนแปลง" : "Discard changes"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void saveChanges()}
            disabled={!hasPendingWork || saving}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />{saving ? (lang === "th" ? "กำลังบันทึก…" : "Saving…") : (lang === "th" ? "บันทึกการเปลี่ยนแปลง" : "Save Changes")}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto max-h-[28rem]">
          <table className="w-full min-w-[820px] text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-950/95">
              <tr className="text-left">
                <th className="py-3 px-4">{lang === "th" ? "โซน" : "Zone"}</th>
                <th className="py-3 px-4">{lang === "th" ? "รหัสแร็ค" : "Rack ID"}</th>
                <th className="py-3 px-4">{lang === "th" ? "สถานะ" : "Status"}</th>
                <th className="py-3 px-4">{lang === "th" ? "ขนาดตู้" : "Cabinet Size"}</th>
                <th className="py-3 px-4">{lang === "th" ? "รายละเอียด" : "Detail"}</th>
                <th className="py-3 px-4">{lang === "th" ? "ประเภทอุปกรณ์" : "Device Type"}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 && (
                <tr><td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                  {lang === "th" ? "ไม่พบแร็คที่ตรงกับตัวกรอง" : "No racks match the current filters."}
                </td></tr>
              )}
              {filteredRecords.map(record => {
                const pending = staged.get(record.rowNumber);
                const currentValue = pending?.newStatus ?? record.status ?? "";
                return (
                  <tr key={`${record.rowNumber}-${record.rackId ?? "blank"}`} className={`border-t border-slate-800 ${pending ? "bg-amber-400/5" : ""}`}>
                    <td className="py-2 px-4">{record.rackZone ?? "—"}</td>
                    <td className="py-2 px-4 font-mono">{record.rackId ?? "—"}</td>
                    <td className="py-2 px-4">
                      <select
                        value={currentValue}
                        onChange={e => stageChange(record, e.target.value)}
                        className={`bg-slate-950 border rounded-md px-2 py-1 text-xs ${pending ? "border-amber-400/60 text-amber-300" : "border-slate-800 text-slate-200"}`}
                      >
                        {!RACK_CANONICAL_STATUSES.includes(currentValue as (typeof RACK_CANONICAL_STATUSES)[number]) && currentValue && (
                          <option value={currentValue}>{currentValue}</option>
                        )}
                        {RACK_CANONICAL_STATUSES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
                      </select>
                    </td>
                    <td className="py-2 px-4">{record.cabinetSize ?? "—"}</td>
                    <td className="py-2 px-4">{record.detail ?? "—"}</td>
                    <td className="py-2 px-4">{record.deviceType ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
