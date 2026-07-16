import React, { useCallback, useState } from "react";
import { Clock, FileSpreadsheet, FolderOpen, Upload } from "lucide-react";
import { getDesktopBridge } from "../data/ProviderFactory";

interface WelcomePanelProps {
  lang: "th" | "en";
  recentFiles: string[];
  isBusy: boolean;
  onOpenDialog: () => void;
  onOpenPath: (path: string) => void;
}

/**
 * Shown in the desktop app when no workbook is open yet: open via native
 * picker, reopen a recent file, or drag & drop a workbook onto the panel.
 */
export default function WelcomePanel({ lang, recentFiles, isBusy, onOpenDialog, onOpenPath }: WelcomePanelProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const bridge = getDesktopBridge();
      if (!bridge) return;
      const path = bridge.files.getPathForFile(file);
      if (path && /\.(xlsm|xlsx)$/i.test(path)) {
        onOpenPath(path);
      }
    },
    [onOpenPath]
  );

  return (
    <div
      onDragOver={e => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`p-12 text-center bg-slate-900/90 border rounded-3xl max-w-xl mx-auto my-12 space-y-6 shadow-2xl animate-fadeIn transition-colors ${
        dragOver ? "border-indigo-500/60 bg-indigo-950/20" : "border-slate-800"
      }`}
    >
      <div className="relative inline-flex items-center justify-center p-4 bg-teal-500/10 border border-teal-500/25 rounded-2xl">
        <FileSpreadsheet className="w-8 h-8 text-teal-400" />
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-slate-100 tracking-tight">
          {lang === "th" ? "เปิดไฟล์ฐานข้อมูล Excel เพื่อเริ่มใช้งาน" : "Open your Excel workbook to begin"}
        </h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
          {lang === "th"
            ? "ข้อมูลทั้งหมดจะถูกอ่านและบันทึกลงไฟล์ RST_Dashboard.xlsm โดยตรง ทำงานแบบออฟไลน์ได้เต็มรูปแบบ พร้อมสำรองไฟล์อัตโนมัติทุกครั้งก่อนบันทึก"
            : "All data is read from and saved directly into your RST_Dashboard.xlsm - fully offline, with an automatic backup before every save."}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          onClick={onOpenDialog}
          disabled={isBusy}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-xs text-slate-100 font-bold rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20 cursor-pointer disabled:opacity-50"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>{lang === "th" ? "เปิดไฟล์ Workbook..." : "Open Workbook…"}</span>
        </button>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-medium">
          <Upload className="w-3 h-3" />
          {lang === "th" ? "หรือลากไฟล์ .xlsm มาวางที่นี่" : "or drag & drop an .xlsm file here"}
        </div>
      </div>

      {recentFiles.length > 0 && (
        <div className="pt-4 border-t border-slate-850 space-y-2 text-left">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            <Clock className="w-3 h-3" />
            {lang === "th" ? "ไฟล์ล่าสุด" : "Recent files"}
          </div>
          {recentFiles.slice(0, 5).map(file => (
            <button
              key={file}
              onClick={() => onOpenPath(file)}
              disabled={isBusy}
              className="w-full text-left px-3 py-2 bg-slate-950/60 hover:bg-slate-800/70 border border-slate-850 rounded-xl text-xs text-slate-300 font-mono truncate transition-all cursor-pointer disabled:opacity-50"
              title={file}
            >
              {file}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
