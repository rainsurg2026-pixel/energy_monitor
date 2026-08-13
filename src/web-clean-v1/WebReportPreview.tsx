import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { buildReportHtml } from "../reports/pdf/reportHtml";
import type { MonthlyLog } from "../types";
import { api } from "./api";
import { facilityReportData, rackReportFromSnapshot, type RackSnapshotApiResponse } from "./exports";

/** Browser counterpart of Desktop's report preview. It deliberately uses the
 * same ReportData builder and HTML renderer as PDF export, so preview cannot
 * display calculations different from the generated report. */
export default function WebReportPreview({ lang, siteId, siteName, logs, month, rackCapacityHistory, rackUnitCapacity, calculationLogs }: {
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
}) {
  const th = lang === "th";
  const [rack, setRack] = useState<ReturnType<typeof rackReportFromSnapshot>>(null);
  const [rackNotice, setRackNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [zoom, setZoom] = useState(85);

  const loadRack = useCallback(async () => {
    if (siteId === null) { setRack(null); return; }
    try {
      const response = await api<RackSnapshotApiResponse>(`/racks?siteId=${siteId}&month=${month}`);
      setRack(rackReportFromSnapshot(response));
      setRackNotice(null);
    } catch {
      setRack(null);
      setRackNotice(th ? "ไม่สามารถโหลดความจุแร็คสำหรับตัวอย่างนี้ได้ รายงานจะแสดงเฉพาะข้อมูลที่มี" : "Rack Capacity is unavailable for this preview; the report remains limited to available data.");
    }
  }, [month, siteId, th]);

  useEffect(() => { void loadRack(); }, [loadRack, refreshKey]);

  const html = useMemo(
    () => buildReportHtml(facilityReportData(logs, siteName, month, rack, rackCapacityHistory, rackUnitCapacity, calculationLogs ?? logs)),
    [calculationLogs, logs, month, rack, rackCapacityHistory, rackUnitCapacity, siteName]
  );
  const pageCount = (html.match(/page-break-(before|after)/g)?.length ?? 0) + 1;

  return <section className="mt-5 overflow-hidden rounded-xl border border-slate-800 bg-slate-900" data-testid="web-report-preview">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 p-4"><div><h3 className="font-semibold">{th ? "ตัวอย่างรายงานสด" : "Live Preview"}</h3><p className="mt-1 text-xs text-slate-400">{th ? `เดือนรายงานปัจจุบัน: ${month} · ${pageCount} หน้า ใช้ renderer เดียวกับรายงาน PDF` : `Current reporting month: ${month} · ${pageCount} pages. Uses the same renderer as the PDF report.`}</p></div><button type="button" onClick={() => setRefreshKey(key => key + 1)} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-teal-500"><RotateCcw className="h-4 w-4" />{th ? "โหลดตัวอย่างใหม่" : "Refresh preview"}</button></div>
    {rackNotice && <p role="status" className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">{rackNotice}</p>}
    <div className="flex justify-end border-b border-slate-800 bg-slate-950 px-4 pt-3"><div className="flex items-center rounded-lg border border-slate-700 text-xs text-slate-300"><button type="button" aria-label={th ? "ลดขนาดตัวอย่างรายงาน" : "Zoom out"} onClick={() => setZoom(value => Math.max(50, value - 10))} className="px-2 py-1.5 hover:text-white">−</button><span className="min-w-12 text-center text-[10px] text-slate-500">{zoom}%</span><button type="button" aria-label={th ? "เพิ่มขนาดตัวอย่างรายงาน" : "Zoom in"} onClick={() => setZoom(value => Math.min(120, value + 10))} className="px-2 py-1.5 hover:text-white">+</button></div></div>
    <div className="max-h-[760px] overflow-auto bg-slate-950 p-4"><div style={{ width: `${zoom}%`, minWidth: "640px" }} className="mx-auto origin-top"><iframe title={th ? "ตัวอย่างรายงานของไซต์ปัจจุบัน" : "Current facility report preview"} sandbox="" srcDoc={html} className="h-[720px] w-full rounded bg-white shadow-2xl" /></div></div>
  </section>;
}
