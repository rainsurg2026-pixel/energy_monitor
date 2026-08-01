import { useEffect, useMemo, useRef, useState } from "react";
import type { RackUnitCapacityRow } from "../../excel/RackUnitCapacityWriter";
import type { IDataProvider } from "../../data/IDataProvider";
import { validateImageBytes } from "../../utils/imageValidation";
import { formatRatioPercent } from "../../utils/rackCapacity";
import { notify } from "../Toast";
import { Save, ImagePlus, Trash2, Boxes, Camera } from "lucide-react";
import { useRackCapacity } from "./RackCapacityContext";
import { monthNames } from "../../utils/monthUtils";

interface StagedImage {
  bytes: Uint8Array;
  previewUrl: string;
}




/**
 * Live UI preview only - the single AUTHORITATIVE calculation that actually
 * gets persisted lives server-side in RackUnitCapacityWriter.ts's
 * deriveRackUnitCapacityRow (that module pulls in fs/path and cannot be
 * imported into the renderer bundle - see ExcelZipUtils.ts's header comment
 * for why that distinction matters). Duplicated here only because it is two
 * lines of arithmetic; the server recomputes it authoritatively on save
 * regardless of what this preview shows.
 */
function previewAvailability(totalU: number, usedU: number): { availableU: number; availabilityPct: number | null } {
  const availableU = totalU - usedU;
  const availabilityPct = totalU > 0 ? availableU / totalU : null;
  return { availableU, availabilityPct };
}

export default function RackUnitCapacityPanel({
  provider,
  onSaved,
  onImageHistorySaved
}: {
  provider: IDataProvider;
  onSaved?: (rows: RackUnitCapacityRow[]) => void;
  /** Fired after a staged image is successfully recorded to the v2.2.5
   *  per-month image history - lets the page bump a refresh key so
   *  RackUnitCapacitySummary re-fetches the image it may already be
   *  showing (or not showing) for this same month. */
  onImageHistorySaved?: () => void;
}) {
  const { lang, facilityName, reportingMonth: month, setReportingMonth: onMonthChange, rackUnitCapacity } = useRackCapacity();
  const rows = rackUnitCapacity;
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  const existingRow = useMemo(() => rows.find(r => r.month === month) ?? null, [rows, month]);

  const [totalU, setTotalU] = useState<string>("");
  const [usedU, setUsedU] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stagedImage, setStagedImage] = useState<StagedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset the inputs whenever the selected month (or its underlying saved
  // row) changes - never carry a stale draft from one month into another.
  useEffect(() => {
    setTotalU(existingRow ? String(existingRow.totalU) : "");
    setUsedU(existingRow ? String(existingRow.usedU) : "");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, existingRow?.totalU, existingRow?.usedU]);

  useEffect(() => {
    return () => {
      if (stagedImage) URL.revokeObjectURL(stagedImage.previewUrl);
    };
  }, [stagedImage]);

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
    setStagedImage({ bytes: buffer, previewUrl: URL.createObjectURL(file) });
  };

  const removeStagedImage = () => {
    if (stagedImage) URL.revokeObjectURL(stagedImage.previewUrl);
    setStagedImage(null);
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const totalNum = totalU.trim() === "" ? 0 : Number(totalU);
  const usedNum = usedU.trim() === "" ? 0 : Number(usedU);
  const hasAnyInput = totalU.trim() !== "" || usedU.trim() !== "";
  const preview = previewAvailability(totalNum, usedNum);

  const hasPendingWork = dirty || stagedImage !== null;

  const years = useMemo(() => {
    const known = new Set(rows.map(r => Number(r.month.split("-")[0])).filter(Number.isFinite));
    known.add(year);
    known.add(new Date().getFullYear());
    const min = Math.min(...known) - 1;
    const max = Math.max(...known) + 1;
    const list: number[] = [];
    for (let y = min; y <= max; y++) list.push(y);
    return list;
  }, [rows, year]);

  const monthNamesList = useMemo(() => monthNames(lang), [lang]);

  const saveChanges = async () => {
    if (!hasPendingWork || !provider.saveRackUnitCapacity) return;
    if (totalU.trim() === "" || usedU.trim() === "") {
      notify("error", lang === "th" ? "กรุณากรอกทั้ง Total (U) และ Used (U)" : "Enter both Total (U) and Used (U).");
      return;
    }
    if (totalNum < 0 || usedNum < 0) {
      notify("error", lang === "th" ? "ค่าต้องไม่ติดลบ" : "Values cannot be negative.");
      return;
    }
    setSaving(true);
    try {
      // The Total/Used upsert never carries an image anymore - a staged
      // image is recorded separately, below, into the per-month image
      // history (v2.2.5), not the old single global slot.
      const result = await provider.saveRackUnitCapacity({ month, totalU: totalNum, usedU: usedNum }, null);
      notify("success", lang === "th" ? "บันทึกความจุหน่วยแร็คแล้ว" : "Rack Unit Capacity saved.");
      setDirty(false);

      if (stagedImage && provider.saveRackUnitCapacityImageHistory) {
        try {
          await provider.saveRackUnitCapacityImageHistory(facilityName ?? "Unknown", month, { bytes: stagedImage.bytes });
          onImageHistorySaved?.();
        } catch (imgErr) {
          notify("error", imgErr instanceof Error ? imgErr.message : String(imgErr));
        }
      }
      removeStagedImage();
      onSaved?.(result.rows);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const [snapshotting, setSnapshotting] = useState(false);

  /** Records this month's Rack Unit Capacity row from the currently
   *  displayed Total (U)/Used (U) values, even with zero unsaved edits - a
   *  deliberate, separate action from Save (which never writes a no-op to
   *  the backup history). */
  const createSnapshot = async () => {
    if (!provider.saveRackUnitCapacity) return;
    if (totalU.trim() === "" || usedU.trim() === "") {
      notify("error", lang === "th" ? "กรุณากรอกทั้ง Total (U) และ Used (U)" : "Enter both Total (U) and Used (U).");
      return;
    }
    if (totalNum < 0 || usedNum < 0) {
      notify("error", lang === "th" ? "ค่าต้องไม่ติดลบ" : "Values cannot be negative.");
      return;
    }
    setSnapshotting(true);
    try {
      const result = await provider.saveRackUnitCapacity({ month, totalU: totalNum, usedU: usedNum }, null, true);
      notify("success", lang === "th" ? "บันทึกสแนปช็อตความจุหน่วยแร็คประจำเดือนแล้ว" : "Recorded this month's Rack Unit Capacity snapshot.");
      onSaved?.(result.rows);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setSnapshotting(false);
    }
  };

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400"><Boxes className="w-5 h-5" /></div>
          <div>
            <h3 className="text-base text-slate-100">{lang === "th" ? "ความจุหน่วยแร็ค" : "Rack Unit Capacity"}</h3>
            <p className="text-xs text-slate-400 mt-1">
              {lang === "th" ? "บันทึกจำนวนหน่วย (U) ทั้งหมดและที่ใช้งานในแต่ละเดือน" : "Record total and used rack-unit (U) space for each month."}
            </p>
          </div>
        </div>
        {hasPendingWork && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-3 py-1">
            {lang === "th" ? "มีการเปลี่ยนแปลงที่ยังไม่บันทึก" : "Unsaved changes"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "เดือน" : "Month"}</label>
          <select
            value={monthNum}
            onChange={e => onMonthChange(`${year}-${String(Number(e.target.value)).padStart(2, "0")}`)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
          >
            {monthNamesList.map((name, idx) => <option key={name} value={idx + 1}>{name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "ปี" : "Year"}</label>
          <select
            value={year}
            onChange={e => onMonthChange(`${e.target.value}-${String(monthNum).padStart(2, "0")}`)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "จำนวนหน่วยทั้งหมด (U)" : "Total (U)"}</label>
          <input
            type="number"
            min={0}
            value={totalU}
            onChange={e => { setTotalU(e.target.value); setDirty(true); }}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">{lang === "th" ? "จำนวนหน่วยที่ใช้ (U)" : "Used (U)"}</label>
          <input
            type="number"
            min={0}
            value={usedU}
            onChange={e => { setUsedU(e.target.value); setDirty(true); }}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs text-slate-500">{lang === "th" ? "หน่วยที่ว่าง (U)" : "Available (U)"}</p>
          <p className="text-lg text-slate-100 mt-1">{hasAnyInput ? preview.availableU : "—"}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <p className="text-xs text-slate-500">{lang === "th" ? "% ความจุที่ว่าง" : "Availability Capacity (%)"}</p>
          <p className="text-lg text-slate-100 mt-1">{hasAnyInput ? formatRatioPercent(preview.availabilityPct) : "—"}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm text-slate-200">{lang === "th" ? "รูปภาพความจุหน่วยแร็ค" : "Rack Unit Capacity Image"}</h4>
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
            <img src={stagedImage.previewUrl} alt="Rack Unit Capacity preview" className="h-24 w-auto max-w-[240px] object-contain rounded-md border border-slate-800" />
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

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void createSnapshot()}
          disabled={snapshotting || saving || totalU.trim() === "" || usedU.trim() === ""}
          title={lang === "th" ? "บันทึกสแนปช็อตของเดือนนี้ด้วยค่าที่แสดงอยู่ แม้ไม่มีการแก้ไข" : "Record this month's snapshot from the displayed values, even with no edits"}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg border border-slate-700 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800 transition-colors"
        >
          <Camera className="w-3.5 h-3.5" />{snapshotting ? (lang === "th" ? "กำลังบันทึก…" : "Recording…") : (lang === "th" ? "บันทึกสแนปช็อตประจำเดือน" : "Record Monthly Snapshot")}
        </button>
        <button
          type="button"
          onClick={() => void saveChanges()}
          disabled={!hasPendingWork || saving}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
        >
          <Save className="w-3.5 h-3.5" />{saving ? (lang === "th" ? "กำลังบันทึก…" : "Saving…") : (lang === "th" ? "บันทึกความจุหน่วยแร็ค" : "Save Rack Unit Capacity")}
        </button>
      </div>
    </section>
  );
}
