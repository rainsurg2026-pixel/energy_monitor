import React from "react";
import { FileSpreadsheet, FolderOpen, FolderSearch, Lock, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { DataSnapshot } from "../data/IDataProvider";

interface WorkbookBarProps {
  workbook: DataSnapshot;
  isDirty: boolean;
  isBusy: boolean;
  lang: "th" | "en";
  onOpen: () => void;
  onReload: () => void;
  onSaveAs: () => void;
  onShowInFolder: () => void;
}

/**
 * Desktop workbook status strip: which file is open, its health at a glance,
 * and the Open / Reload / Save As actions. Rendered only in the desktop app.
 */
export default function WorkbookBar({
  workbook,
  isDirty,
  isBusy,
  lang,
  onOpen,
  onReload,
  onSaveAs,
  onShowInFolder
}: WorkbookBarProps) {
  const monthCount = workbook.health?.monthCount ?? workbook.logs.length;
  const lockVisible = workbook.lock?.locked || workbook.lock?.excelOwnerFilePresent;

  const btn =
    "flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-750 active:bg-slate-700 text-[11px] " +
    "text-slate-200 font-semibold rounded-xl border border-slate-750 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-wait";

  return (
    <section className="bg-slate-900 border border-slate-850 p-4 rounded-2xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <span className="p-2 bg-teal-500/10 rounded-lg border border-teal-500/20 text-teal-400 shrink-0">
          <FileSpreadsheet className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-semibold text-slate-100 text-sm truncate" title={workbook.path}>
              {workbook.sourceLabel}
            </h3>
            {isDirty ? (
              <span className="px-2 py-0.5 bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[10px] font-bold rounded-md uppercase tracking-wider">
                {lang === "th" ? "มีการแก้ไขที่ยังไม่บันทึก" : "Unsaved changes"}
              </span>
            ) : (
              <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold rounded-md uppercase tracking-wider">
                {lang === "th" ? "บันทึกแล้ว" : "Saved"}
              </span>
            )}
            {lockVisible && (
              <span
                className="px-2 py-0.5 bg-rose-500/10 border border-rose-500/25 text-rose-400 text-[10px] font-bold rounded-md uppercase tracking-wider flex items-center gap-1"
                title={
                  lang === "th"
                    ? "ไฟล์อาจถูกเปิดอยู่ใน Excel - การบันทึกอาจล้มเหลวจนกว่าจะปิด"
                    : "The workbook appears to be open in Excel - saving may fail until it is closed"
                }
              >
                <Lock className="w-3 h-3" />
                {lang === "th" ? "เปิดอยู่ใน Excel" : "Open in Excel"}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 truncate" title={workbook.path}>
            {monthCount} {lang === "th" ? "เดือน" : "months"} · {workbook.path}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap shrink-0">
        {workbook.health && !workbook.health.structureOk && (
          <span className="flex items-center gap-1 text-[11px] text-amber-400 font-semibold">
            <TriangleAlert className="w-3.5 h-3.5" />
            {lang === "th" ? "โครงสร้างไฟล์มีปัญหา" : "Structure issues"}
          </span>
        )}
        <button onClick={onOpen} disabled={isBusy} className={btn}>
          <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
          <span>{lang === "th" ? "เปิดไฟล์..." : "Open…"}</span>
        </button>
        <button onClick={onReload} disabled={isBusy} className={btn} title={lang === "th" ? "อ่านข้อมูลจากไฟล์ใหม่" : "Re-read the workbook from disk"}>
          <RefreshCw className={`w-3.5 h-3.5 text-teal-400 ${isBusy ? "animate-spin" : ""}`} />
          <span>{lang === "th" ? "โหลดใหม่" : "Reload"}</span>
        </button>
        <button onClick={onSaveAs} disabled={isBusy} className={btn}>
          <Save className="w-3.5 h-3.5 text-emerald-400" />
          <span>{lang === "th" ? "บันทึกเป็น..." : "Save As…"}</span>
        </button>
        <button onClick={onShowInFolder} disabled={isBusy} className={btn} title={lang === "th" ? "เปิดตำแหน่งไฟล์" : "Show in folder"}>
          <FolderSearch className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
    </section>
  );
}
