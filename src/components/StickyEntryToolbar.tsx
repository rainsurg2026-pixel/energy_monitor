import React from "react";
import { Lock, RefreshCw, RotateCcw, Save } from "lucide-react";
import { CompletionSummary } from "../utils/completion";

interface StickyEntryToolbarProps {
  lang: "th" | "en";
  completion: CompletionSummary;
  lastSaved: string | null;
  workbookStatus: "saved" | "dirty" | "locked" | "busy" | "none" | "readonly";
  hasDraftChanges: boolean;
  /** RC2 read-only mode: saving is disabled (viewing/export stay available). */
  readOnly?: boolean;
  /** Lift the toolbar above the desktop status bar. */
  aboveStatusBar?: boolean;
  /** Browser shell has a fixed mobile navigation rail; keep the entry
   * toolbar above it instead of covering its actions. */
  aboveMobileNav?: boolean;
  /** RC3 context chips: facility · month · provider. */
  facilityName?: string | null;
  monthLabel?: string | null;
  provider?: string | null;
  onSaveAll: () => void;
  onResetAll: () => void;
  rackUnitCompletion?: CompletionSummary["rackUnit"];
  /** RC3 jump-to-error: scroll/focus/highlight the section's first empty field. */
  onJumpToSection?: (section: "ups" | "air" | "dc" | "energy" | "rackUnit") => void;
}

/**
 * RC3: always-visible bottom toolbar on the data-entry page.
 * Save (all sections) · Reset · Completion · Last saved · Workbook status.
 */
export default function StickyEntryToolbar({
  lang,
  completion,
  lastSaved,
  workbookStatus,
  hasDraftChanges,
  readOnly = false,
  aboveStatusBar = false,
  aboveMobileNav = false,
  facilityName = null,
  monthLabel = null,
  provider = null,
  onSaveAll,
  onResetAll,
  rackUnitCompletion,
  onJumpToSection
}: StickyEntryToolbarProps) {
  const th = lang === "th";

  const statusMap: Record<StickyEntryToolbarProps["workbookStatus"], { label: string; cls: string; icon?: React.ReactNode }> = {
    saved: { label: th ? "บันทึกแล้ว" : "Saved", cls: "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" },
    dirty: { label: th ? "ยังไม่บันทึก" : "Unsaved", cls: "bg-amber-500/10 border-amber-500/25 text-amber-400" },
    locked: {
      label: th ? "ไฟล์ถูกล็อค" : "Locked",
      cls: "bg-rose-500/10 border-rose-500/25 text-rose-400",
      icon: <Lock className="w-3 h-3" />
    },
    busy: {
      label: th ? "กำลังบันทึก..." : "Saving…",
      cls: "bg-indigo-500/10 border-indigo-500/25 text-indigo-400",
      icon: <RefreshCw className="w-3 h-3 animate-spin" />
    },
    none: { label: th ? "ยังไม่ได้เปิดไฟล์" : "No workbook", cls: "bg-slate-800 border-slate-700 text-slate-400" },
    readonly: {
      label: th ? "อ่านอย่างเดียว" : "Read Only",
      cls: "bg-rose-500/10 border-rose-500/25 text-rose-400",
      icon: <Lock className="w-3 h-3" />
    }
  };
  const status = statusMap[workbookStatus];

  // RC3 interactive validation summary: "UPS 18/18 ✔" — clicking an
  // incomplete section jumps to its first empty field.
  const sectionSummary = (key: "ups" | "air" | "dc" | "energy" | "rackUnit", label: string, summary = completion[key]) => {
    const s = summary;
    const complete = s.total > 0 && s.filled >= s.total;
    return (
      <button
        key={key}
        type="button"
        onClick={() => onJumpToSection?.(key)}
        title={
          complete
            ? `${label}: ${th ? "ครบถ้วน" : "complete"}`
            : `${label}: ${th ? "คลิกเพื่อไปยังช่องแรกที่ยังว่าง" : "click to jump to the first empty field"}`
        }
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          complete ? "hover:bg-slate-800/60" : "hover:bg-amber-500/10"
        }`}
      >
        <span className="text-slate-500">{label}</span>
        <span className={`font-mono font-bold ${complete ? "text-emerald-400" : "text-amber-400"}`}>
          {s.filled}/{s.total}
        </span>
        <span className={complete ? "text-emerald-400" : "text-amber-400"}>{complete ? "✔" : "⚠"}</span>
      </button>
    );
  };

  return (
    <div
      className={`fixed ${aboveStatusBar ? "bottom-[26px]" : aboveMobileNav ? "bottom-14 md:bottom-0" : "bottom-0"} inset-x-0 z-40 bg-slate-900/95 backdrop-blur border-t border-slate-800 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3">
        {/* Save all */}
        <button
          onClick={onSaveAll}
          disabled={workbookStatus === "busy" || readOnly}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
            hasDraftChanges && !readOnly
              ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20"
              : "bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-750"
          }`}
          title={readOnly ? (th ? "โหมดอ่านอย่างเดียว - บันทึกไม่ได้" : "Read-only mode - saving is disabled") : "Ctrl+S"}
        >
          <Save className="w-4 h-4" />
          <span>{th ? "บันทึกทั้งหมด" : "Save All"}</span>
        </button>

        {/* Reset all */}
        <button
          onClick={onResetAll}
          disabled={!hasDraftChanges || workbookStatus === "busy"}
          className="px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 text-slate-400 hover:text-slate-200 border border-slate-800 hover:bg-slate-800/50 transition-colors cursor-pointer disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{th ? "คืนค่า" : "Reset"}</span>
        </button>

        {/* Export is available from the Reports view, not this Data Entry toolbar. */}

        {/* RC3 context: facility · month · provider */}
        {(facilityName || monthLabel || provider) && (
          <span className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-400 font-semibold">
            {facilityName && <span>{facilityName}</span>}
            {facilityName && monthLabel && <span className="text-slate-700">·</span>}
            {monthLabel && <span className="font-mono">{monthLabel}</span>}
            {provider && (
              <>
                <span className="text-slate-700">·</span>
                <span className="text-slate-500">{provider}</span>
              </>
            )}
          </span>
        )}

        <div className="flex-1" />

        {/* RC3 interactive validation summary (filled/total per section) */}
        <div className="hidden md:flex items-center gap-2 text-[11px]">
          {sectionSummary("ups", "UPS")}
          {sectionSummary("air", "Air")}
          {sectionSummary("dc", "DC")}
          {rackUnitCompletion && sectionSummary("rackUnit", "Rack U", rackUnitCompletion)}
          {sectionSummary("energy", th ? "พลังงาน" : "Energy")}
          <span className="text-slate-700">│</span>
          <span className="flex items-center gap-1">
            <span className="text-slate-500">{th ? "รวม" : "Overall"}</span>
            <span
              className={`font-mono font-bold ${
                completion.overall.percent >= 100 ? "text-emerald-400" : completion.overall.percent >= 50 ? "text-amber-400" : "text-rose-400"
              }`}
            >
              {completion.overall.percent}%
            </span>
          </span>
        </div>

        {/* Last saved */}
        <span className="text-[11px] text-slate-500 font-mono hidden sm:inline" title={th ? "บันทึกล่าสุด" : "Last saved"}>
          {lastSaved ?? (th ? "ยังไม่เคยบันทึก" : "never saved")}
        </span>

        {/* RC3 dirty indicator */}
        <span
          data-testid="dirty-indicator"
          className={`flex items-center gap-1 text-[11px] font-bold ${hasDraftChanges ? "text-amber-400" : "text-emerald-400"}`}
          title={th ? "สถานะการแก้ไข" : "Edit state"}
        >
          {hasDraftChanges ? "●" : "✓"}
          <span className="hidden sm:inline">
            {hasDraftChanges ? (th ? "มีการแก้ไขที่ยังไม่บันทึก" : "Unsaved Changes") : th ? "บันทึกครบแล้ว" : "All Changes Saved"}
          </span>
        </span>

        {/* Workbook status */}
        <span className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${status.cls}`}>
          {status.icon}
          {status.label}
        </span>
      </div>
    </div>
  );
}
