import EntryWorkflowHeader from "../components/EntryWorkflowHeader";
import { computeCompletion } from "../utils/completion";
import type { MonthlyLog } from "../types";
import { AlertCircle } from "lucide-react";
import { formatWebSavedTimestamp } from "./formatting";

/** Reuses Desktop's entry month workflow with API-backed data only.
 * Workbook health is deliberately omitted: the browser has no workbook to
 * inspect and must not label the Production database "Healthy" by proxy. */
export default function WebEntryWorkflowHeader({
  lang,
  facilityName,
  months,
  selectedMonth,
  draft,
  onSelectMonth,
  allowedStartMonth,
  allowedEndMonth
}: {
  lang: "th" | "en";
  facilityName: string;
  months: string[];
  selectedMonth: string;
  draft: MonthlyLog;
  onSelectMonth: (month: string) => void;
  allowedStartMonth: string;
  allowedEndMonth: string;
}) {
  const lastSaved = formatWebSavedTimestamp(draft.lastSavedUps ?? draft.lastSavedAir ?? draft.lastSavedDc ?? draft.lastSavedEnergyCost ?? null);
  return <EntryWorkflowHeader
    lang={lang}
    facilityName={facilityName}
    facilityLogo={null}
    workbookLabel="Production API"
    months={months}
    selectedMonth={selectedMonth}
    completion={computeCompletion(draft)}
    health={null}
    showHealth={false}
    lastSaved={lastSaved}
    onSelectMonth={target => onSelectMonth(target)}
    canSelectMonth={target => target >= allowedStartMonth && target <= allowedEndMonth}
  />;
}

/** Matches Desktop's explicit historical-edit warning. It only navigates to
 * an already visible month; it never writes or discards a record. */
export function WebHistoricalEditNotice({ lang, selectedMonth, latestMonth, onReturnToLatest }: {
  lang: "th" | "en";
  selectedMonth: string;
  latestMonth: string | null;
  onReturnToLatest: () => void;
}) {
  if (!latestMonth || selectedMonth === latestMonth) return null;
  const th = lang === "th";
  return <section role="status" className="mt-4 flex flex-col items-start justify-between gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-200 sm:flex-row sm:items-center"><div className="flex items-start gap-2.5"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /><div><b className="block text-[10px] uppercase tracking-wider text-amber-400">{th ? "โหมดแก้ไขข้อมูลย้อนหลัง" : "Historical Data Edit Mode"}</b><span>{th ? `กำลังแก้ไข ${selectedMonth} ไม่ใช่ข้อมูลล่าสุด (${latestMonth}) โปรดตรวจสอบก่อนบันทึก` : `You are editing ${selectedMonth}, not the latest available record (${latestMonth}). Review changes before saving.`}</span></div></div><button type="button" onClick={onReturnToLatest} className="shrink-0 rounded-lg bg-amber-500/20 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-500/30">{th ? "กลับไปข้อมูลล่าสุด" : "Return to latest"}</button></section>;
}
