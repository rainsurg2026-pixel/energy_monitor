import React, { useState } from "react";
import { Archive, Download, FileImage, FileSpreadsheet, FileText, Table2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

export type ExportKind = "pdf" | "excel" | "csv" | "png" | "zip";

interface ExportCenterModalProps {
  open: boolean;
  lang: "th" | "en";
  baseName: string; // e.g. "Rangsit_2026-07_Report"
  onClose: () => void;
  onExport: (kind: ExportKind) => Promise<void>;
}

/**
 * Export Center (RC6): PDF / Excel / CSV / PNG / ZIP package - every export
 * goes through the native save dialog, no browser downloads.
 */
export default function ExportCenterModal({ open, lang, baseName, onClose, onExport }: ExportCenterModalProps) {
  const th = lang === "th";
  const [busy, setBusy] = useState<ExportKind | null>(null);

  const run = async (kind: ExportKind) => {
    setBusy(kind);
    try {
      await onExport(kind);
    } finally {
      setBusy(null);
    }
  };

  const options: Array<{ kind: ExportKind; icon: React.ReactNode; title: string; desc: string; ext: string }> = [
    {
      kind: "pdf",
      icon: <FileText className="w-5 h-5 text-rose-400" />,
      title: "PDF",
      desc: th ? "หน้าปัจจุบันเป็นเอกสาร PDF (แนวนอน A4)" : "Current view as an A4 landscape PDF",
      ext: ".pdf"
    },
    {
      kind: "excel",
      icon: <FileSpreadsheet className="w-5 h-5 text-emerald-400" />,
      title: "Excel",
      desc: th ? "ข้อมูลทุกเดือนเป็นไฟล์รายงาน .xlsx (5 ชีต)" : "All months as a 5-sheet .xlsx report",
      ext: ".xlsx"
    },
    {
      kind: "csv",
      icon: <Table2 className="w-5 h-5 text-indigo-400" />,
      title: "CSV",
      desc: th ? "ข้อมูลทุกเดือนเป็นไฟล์ CSV (4 ส่วนในไฟล์เดียว)" : "All months as CSV (4 sections, one file)",
      ext: ".csv"
    },
    {
      kind: "png",
      icon: <FileImage className="w-5 h-5 text-amber-400" />,
      title: "PNG",
      desc: th ? "ภาพหน้าจอของหน้าปัจจุบัน" : "Screenshot of the current view",
      ext: ".png"
    },
    {
      kind: "zip",
      icon: <Archive className="w-5 h-5 text-teal-400" />,
      title: th ? "ZIP Package (ครบชุด)" : "ZIP Package (everything)",
      desc: th
        ? "PDF + Excel + CSV + ภาพแดชบอร์ด + รายงานความถูกต้องของข้อมูล"
        : "PDF + Excel + CSVs + dashboard PNG + integrity report",
      ext: ".zip"
    }
  ];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-teal-500/10 border border-teal-500/20 text-teal-400 rounded-xl">
                    <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-100 text-base">{th ? "ศูนย์ส่งออกข้อมูล" : "Export Center"}</h3>
                    <p className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider mt-0.5">{baseName}</p>
                  </div>
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2">
                {options.map(opt => (
                  <button
                    key={opt.kind}
                    onClick={() => void run(opt.kind)}
                    disabled={busy !== null}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-slate-950/60 hover:bg-slate-800/70 border border-slate-850 hover:border-slate-700 rounded-xl text-left transition-all cursor-pointer disabled:opacity-50"
                  >
                    <span className="shrink-0">{opt.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-bold text-slate-200">
                        {opt.title}
                        {busy === opt.kind && <span className="ml-2 text-[10px] text-indigo-400 animate-pulse">{th ? "กำลังส่งออก..." : "exporting…"}</span>}
                      </span>
                      <span className="block text-[10px] text-slate-500 mt-0.5">{opt.desc}</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-600 shrink-0">{baseName.slice(0, 18)}…{opt.ext}</span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
