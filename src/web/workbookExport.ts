import type { MonthlyLog } from "../types";
import { buildReportWorkbookBuffer, type ReportRackCapacitySnapshot, type ReportRackUnitCapacitySnapshot } from "../reporting/reportWorkbook";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type WebRackCapacitySnapshot = ReportRackCapacitySnapshot;
type WebRackUnitCapacitySnapshot = ReportRackUnitCapacitySnapshot;

/** Browser-side counterpart of the Desktop Export Center workbook shape. */
export async function buildWebWorkbook(logs: readonly MonthlyLog[], facility: string, rackCapacitySnapshots: readonly WebRackCapacitySnapshot[] = [], rackUnitCapacitySnapshots: readonly WebRackUnitCapacitySnapshot[] = []): Promise<Blob> {
  const buffer = await buildReportWorkbookBuffer(
    logs,
    facility,
    rackCapacitySnapshots as ReportRackCapacitySnapshot[],
    rackUnitCapacitySnapshots as ReportRackUnitCapacitySnapshot[]
  );
  return new Blob([buffer as BlobPart], { type: XLSX_MIME });
}
