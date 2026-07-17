import React from "react";
import { Download, Lock, RefreshCw, RotateCcw, Save } from "lucide-react";
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
  onSaveAll: () => void;
  onResetAll: () => void;
  onExport: () => void;
}

/**
 * RC3: always-visible bottom toolbar on the data-entry page.
 * Save (all sections) · Reset · Export · Completion · Last saved · Workbook status.
 */
export default function StickyEntryToolbar({
  lang,
  completion,
  lastSaved,
  workbookStatus,
  hasDraftChanges,
  readOnly = false,
  aboveStatusBar = false,
  onSaveAll,
  onResetAll,
  onExport
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

  const sectionPct = (label: string, pct: number) => (
    <span key={label} className="flex items-center gap-1">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono font-bold ${pct >= 100 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-rose-400"}`}>
        {pct}%
      </span>
    </span>
  );

  return (
    <div
      className={`fixed ${aboveStatusBar ? "bottom-[26px]" : "bottom-0"} inset-x-0 z-40 bg-slate-900/95 backdrop-blur border-t border-slate-800 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-3">
        {/* Save all */}
        <button
          onClick={onSaveAll}
          disabled={workbookStatus === "busy" || readOnly}
          className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
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
          className="px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 text-slate-400 hover:text-slate-200 border border-slate-800 hover:bg-slate-800/50 transition-colors cursor-pointer disabled:opacity-40"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>{th ? "คืนค่า" : "Reset"}</span>
        </button>

        {/* Export */}
        <button
          onClick={onExport}
          className="px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 text-slate-300 hover:text-slate-100 border border-slate-800 hover:bg-slate-800/50 transition-colors cursor-pointer"
          title="Ctrl+E"
        >
          <Download className="w-3.5 h-3.5 text-teal-400" />
          <span>{th ? "ส่งออก" : "Export"}</span>
        </button>

        <div className="flex-1" />

        {/* Per-section + overall completion */}
        <div className="hidden md:flex items-center gap-3 text-[11px]">
          {sectionPct("UPS", completion.ups.percent)}
          {sectionPct("Air", completion.air.percent)}
          {sectionPct("DC", completion.dc.percent)}
          {sectionPct(th ? "พลังงาน" : "Energy", completion.energy.percent)}
          <span className="text-slate-700">│</span>
          {sectionPct(th ? "รวม" : "Overall", completion.overall.percent)}
        </div>

        {/* Last saved */}
        <span className="text-[11px] text-slate-500 font-mono hidden sm:inline" title={th ? "บันทึกล่าสุด" : "Last saved"}>
          {lastSaved ?? (th ? "ยังไม่เคยบันทึก" : "never saved")}
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
