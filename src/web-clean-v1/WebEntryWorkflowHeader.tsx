import EntryWorkflowHeader from "../components/EntryWorkflowHeader";
import { computeCompletion } from "../utils/completion";
import type { MonthlyLog } from "../types";

/** Reuses Desktop's entry month workflow with API-backed data only.
 * Workbook health is deliberately omitted: the browser has no workbook to
 * inspect and must not label the Production database "Healthy" by proxy. */
export default function WebEntryWorkflowHeader({
  facilityName,
  months,
  selectedMonth,
  draft,
  onSelectMonth
}: {
  facilityName: string;
  months: string[];
  selectedMonth: string;
  draft: MonthlyLog;
  onSelectMonth: (month: string) => void;
}) {
  const lastSaved = draft.lastSavedUps ?? draft.lastSavedAir ?? draft.lastSavedDc ?? draft.lastSavedEnergyCost ?? null;
  return <EntryWorkflowHeader
    lang="en"
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
  />;
}
