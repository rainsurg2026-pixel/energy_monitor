import React from "react";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

export type SaveStageKey = "validate" | "lock" | "backup" | "write" | "verify" | "refresh" | "done";

export interface SaveProgressState {
  /** Stages before `current` are complete; `current` is in progress. */
  current: SaveStageKey;
  /** Set when the save failed; names the stage that broke + message. */
  failedAt?: SaveStageKey;
  error?: string;
  startedAt: number; // performance.now()
  /** Filled in when the save finished (success or failure). */
  elapsedMs?: number;
}

interface SaveProgressProps {
  lang: "th" | "en";
  state: SaveProgressState;
  onDismiss: () => void;
}

const STAGE_ORDER: SaveStageKey[] = ["validate", "lock", "backup", "write", "verify", "refresh", "done"];

/**
 * RC3: staged save progress card (bottom-right, above the sticky toolbar).
 * Validating → Checking Lock → Creating Backup → Writing Workbook → Verifying → Refreshing
 * Dashboard → Completed, with elapsed time and graceful failure display.
 */
export default function SaveProgress({ lang, state, onDismiss }: SaveProgressProps) {
  const th = lang === "th";
  const labels: Record<SaveStageKey, string> = {
    validate: th ? "ตรวจสอบความครบถ้วน" : "Validating",
    lock: th ? "ตรวจสอบการล็อคไฟล์" : "Checking Lock",
    backup: th ? "สำรองไฟล์ก่อนบันทึก" : "Creating Backup",
    write: th ? "เขียนไฟล์ Workbook" : "Writing Workbook",
    verify: th ? "ตรวจทานไฟล์ที่บันทึก" : "Verifying Workbook",
    refresh: th ? "โหลดแดชบอร์ดใหม่" : "Refreshing Dashboard",
    done: th ? "เสร็จสมบูรณ์" : "Completed"
  };

  const currentIdx = STAGE_ORDER.indexOf(state.failedAt ?? state.current);
  const finished = state.current === "done" || !!state.failedAt;

  return (
    <div
      data-testid="save-progress"
      className="fixed right-4 bottom-24 z-50 w-72 bg-slate-900/95 backdrop-blur border border-slate-800 rounded-2xl shadow-2xl p-4 space-y-2 animate-fadeIn"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-100">
          {state.failedAt
            ? th
              ? "บันทึกไม่สำเร็จ"
              : "Save failed"
            : state.current === "done"
              ? th
                ? "บันทึกสำเร็จ"
                : "Saved"
              : th
                ? "กำลังบันทึก..."
                : "Saving…"}
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          {state.elapsedMs !== undefined
            ? `${formatNumber2(state.elapsedMs / 1000)}s`
            : ""}
        </span>
      </div>

      <div className="space-y-1">
        {STAGE_ORDER.map((key, i) => {
          if (key === "done" && !finished) return null;
          const failedHere = state.failedAt === key;
          const complete = !failedHere && (i < currentIdx || state.current === "done");
          const active = !finished && key === state.current;
          if (!complete && !active && !failedHere) {
            return (
              <p key={key} className="flex items-center gap-2 text-[11px] text-slate-600">
                <span className="w-3.5" />
                {labels[key]}
              </p>
            );
          }
          return (
            <p
              key={key}
              className={`flex items-center gap-2 text-[11px] ${
                failedHere ? "text-rose-400" : complete ? "text-emerald-400" : "text-indigo-300"
              }`}
            >
              {failedHere ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : complete ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              {labels[key]}
            </p>
          );
        })}
      </div>

      {state.failedAt && state.error && (
        <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 leading-relaxed">
          {state.error}
        </p>
      )}

      {finished && (
        <button
          type="button"
          onClick={onDismiss}
          className="w-full py-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200 bg-slate-800/60 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {th ? "ปิด" : "Dismiss"}
        </button>
      )}
    </div>
  );
}
