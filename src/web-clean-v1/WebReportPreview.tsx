import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { buildCurrentFacilityPdfHtml, buildReportHtml } from "../reports/pdf/reportHtml";
import type { MonthlyLog } from "../types";
import type { UpsGroupHistoryReport } from "../reports/reportTypes";
import type { ReportSectionId } from "../reporting/reportingTypes";
import { api } from "./api";
import { facilityReportData, rackReportFromSnapshot, type RackSnapshotApiResponse } from "./exports";
import { loadWebRackUnitCapacityImage, type WebRackUnitCapacityImage } from "./rackUnitImage";

/** Browser counterpart of Desktop's report preview. It deliberately uses the
 * same ReportData builder and HTML renderer as PDF export, so preview cannot
 * display calculations different from the generated report. */
export default function WebReportPreview({ lang, siteId, siteName, logs, month, rackCapacityHistory, rackUnitCapacity, calculationLogs, upsGroupHistory, sections, onRefresh, contextLabel, selectedFormatLabel, overrideHtml, currentFacilityPdf, pending }: {
  lang: "th" | "en";
  siteId: number | null;
  siteName: string;
  /** Logs included in the selected report period. */
  logs: MonthlyLog[];
  month: string;
  rackCapacityHistory: RackCapacityHistoryRow[];
  rackUnitCapacity: RackUnitCapacityRow[];
  /** Full history used only as the previous-reading context for calculations. */
  calculationLogs?: MonthlyLog[];
  /** Persisted Dashboard-FAC UPS status used by the engineering report page. */
  upsGroupHistory?: UpsGroupHistoryReport | null;
  sections?: readonly ReportSectionId[];
  /** Reloads the source history before rebuilding the preview. */
  onRefresh?: () => Promise<void>;
  /** "<scope> · <site?> · <period>" line shown in the preview header. */
  contextLabel?: string;
  /** Secondary hint: the download format the user last picked. */
  selectedFormatLabel?: string | null;
  /** For the All Facilities / Site Comparison scopes: pre-built report HTML
   *  (same model as the export). When null the single-facility preview below
   *  is used. */
  overrideHtml?: string | null;
  /** Current Facility uses the exact PDF-only structure in its preview. */
  currentFacilityPdf?: boolean;
  /** The scoped preview HTML is still being assembled. */
  pending?: boolean;
}) {
  const th = lang === "th";
  const [rack, setRack] = useState<ReturnType<typeof rackReportFromSnapshot>>(null);
  const [rackUnitImage, setRackUnitImage] = useState<WebRackUnitCapacityImage | null>(null);
  const [rackNotice, setRackNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [zoom, setZoom] = useState(85);
  const [refreshing, setRefreshing] = useState(false);

  const loadRack = useCallback(async () => {
    if (siteId === null) { setRack(null); setRackUnitImage(null); return; }
    try {
      const [response, image] = await Promise.all([
        api<RackSnapshotApiResponse>(`/racks?siteId=${siteId}&month=${month}`),
        loadWebRackUnitCapacityImage(siteId, month).catch(() => null)
      ]);
      setRack(rackReportFromSnapshot(response));
      setRackUnitImage(image);
      setRackNotice(null);
    } catch {
      setRack(null);
      setRackUnitImage(null);
      setRackNotice(th ? "ไม่สามารถโหลดความจุแร็คสำหรับตัวอย่างนี้ได้ รายงานจะแสดงเฉพาะข้อมูลที่มี" : "Rack Capacity is unavailable for this preview; the report remains limited to available data.");
    }
  }, [month, siteId, th]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setRackNotice(null);
    try {
      await onRefresh?.();
      await loadRack();
      setRefreshKey(key => key + 1);
    } catch {
      setRackNotice(th ? "ไม่สามารถโหลดข้อมูลรายงานใหม่ได้ กรุณาลองอีกครั้ง" : "The report data could not be refreshed. Try again.");
    } finally {
      setRefreshing(false);
    }
  }, [loadRack, onRefresh, th]);

  useEffect(() => { void loadRack(); }, [loadRack]);

  const currentFacilityHtml = useMemo(
    () => (currentFacilityPdf ? buildCurrentFacilityPdfHtml : buildReportHtml)(facilityReportData(logs, siteName, month, rack, rackCapacityHistory, rackUnitCapacity, calculationLogs ?? logs, {
      upsGroupHistory,
      rackUnitCapacityImageDataUri: rackUnitImage?.dataUri ?? null,
      rackUnitCapacityImageMeta: rackUnitImage?.meta ?? null
    }), sections),
    [calculationLogs, logs, month, rack, rackCapacityHistory, rackUnitCapacity, rackUnitImage, refreshKey, sections, siteName, upsGroupHistory, currentFacilityPdf]
  );
  const html = overrideHtml ?? currentFacilityHtml;
  const pageCount = (html.match(/page-break-(before|after)/g)?.length ?? 0) + 1;
  const headerLine = contextLabel ?? (th ? `เดือนรายงานปัจจุบัน: ${month}` : `Current reporting month: ${month}`);

  return <section className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-900" data-testid="web-report-preview">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4"><div className="min-w-0"><h3 className="font-semibold">{th ? "ตัวอย่างรายงานสด" : "Live Preview"}</h3><p className="mt-1 text-xs text-slate-300" data-testid="web-report-preview-context">{headerLine}</p><p className="mt-0.5 text-xs text-slate-500">{th ? `${pageCount} หน้า · ใช้ renderer เดียวกับรายงาน PDF` : `${pageCount} pages · same renderer as the PDF report`}{selectedFormatLabel ? (th ? ` · ส่งออกที่เลือก: ${selectedFormatLabel}` : ` · Selected export: ${selectedFormatLabel}`) : ""}</p></div><button type="button" disabled={refreshing} onClick={() => void handleRefresh()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-teal-500 disabled:cursor-not-allowed disabled:opacity-60"><RotateCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? (th ? "กำลังโหลดใหม่…" : "Refreshing…") : (th ? "โหลดตัวอย่างใหม่" : "Refresh preview")}</button></div>
    {pending && <p role="status" className="border-b border-teal-500/20 bg-teal-500/10 px-4 py-2 text-xs text-teal-200">{th ? "กำลังเตรียมตัวอย่างรายงาน…" : "Building report preview…"}</p>}
    {rackNotice && <p role="status" className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">{rackNotice}</p>}
    <div className="flex justify-end border-b border-slate-800 bg-slate-950 px-4 pt-3"><div className="flex items-center rounded-lg border border-slate-700 text-xs text-slate-300"><button type="button" aria-label={th ? "ลดขนาดตัวอย่างรายงาน" : "Zoom out"} onClick={() => setZoom(value => Math.max(50, value - 10))} className="px-2 py-1.5 hover:text-white">−</button><span className="min-w-12 text-center text-[10px] text-slate-500">{zoom}%</span><button type="button" aria-label={th ? "เพิ่มขนาดตัวอย่างรายงาน" : "Zoom in"} onClick={() => setZoom(value => Math.min(120, value + 10))} className="px-2 py-1.5 hover:text-white">+</button></div></div>
    <div className="max-h-[760px] overflow-auto bg-slate-950 p-4"><div style={{ width: `${zoom}%`, minWidth: "640px" }} className="mx-auto origin-top"><iframe title={contextLabel ? (th ? `ตัวอย่างรายงาน: ${contextLabel}` : `Report preview: ${contextLabel}`) : (th ? "ตัวอย่างรายงานของไซต์ปัจจุบัน" : "Current facility report preview")} sandbox="" srcDoc={html} className="h-[720px] w-full rounded bg-white shadow-2xl" /></div></div>
  </section>;
}
