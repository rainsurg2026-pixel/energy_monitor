import React, { useMemo, useState } from "react";
import { Activity, CheckCircle2, CopyX, FileWarning, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { DataSnapshot } from "../data/IDataProvider";
import { formatMonthYear } from "../utils";

interface IntegrityCenterProps {
  workbook: DataSnapshot;
  lang: "th" | "en";
  isBusy: boolean;
  onValidate: () => void;
  displayPeriod?: string;
}

const TAB_LABELS: Record<string, string> = {
  UPS: "UPS",
  AIR: "Air Conditioning",
  DC: "DC Panels",
  ENERGY: "Energy & Cost"
};

/**
 * Integrity Center - workbook health and the full data-integrity report
 * (duplicates, missing months, missing devices, invalid IDs, blank rows),
 * mirroring the Google Sheets sync's verification engine for the workbook.
 */
export default function IntegrityCenter({ workbook, lang, isBusy, onValidate, displayPeriod = "2026" }: IntegrityCenterProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const health = workbook.health;
  const integrity = workbook.integrity;

  const issueCount = useMemo(() => {
    if (!health) return 0;
    return health.duplicateCount + health.invalidIdCount + health.blankRowCount;
  }, [health]);

  if (!health || !integrity) return null;

  const healthy = health.structureOk && issueCount === 0;

  const sections = [
    {
      key: "duplicates",
      icon: <CopyX className="w-3.5 h-3.5" />,
      label: lang === "th" ? "ข้อมูลซ้ำซ้อน" : "Duplicate records",
      count: integrity.duplicateKeys.length,
      severity: "error" as const,
      rows: integrity.duplicateKeys.map(
        d => `${TAB_LABELS[d.tab]} · ${formatMonthYear(d.month)}${d.deviceId ? ` · ${d.deviceId}` : ""} → rows ${d.rowNumbers.join(", ")}`
      )
    },
    {
      key: "missingMonths",
      icon: <FileWarning className="w-3.5 h-3.5" />,
      label: lang === "th" ? "เดือนที่ขาดหายในบางชีต" : "Missing months (per sheet)",
      count: integrity.missingMonths.length,
      severity: "warn" as const,
      rows: integrity.missingMonths.map(m => `${TAB_LABELS[m.tab]} · ${formatMonthYear(m.month)}`)
    },
    {
      key: "missingDevices",
      icon: <Activity className="w-3.5 h-3.5" />,
      label: lang === "th" ? "อุปกรณ์ที่ขาดหาย" : "Missing devices",
      count: integrity.missingDevices.length,
      severity: "warn" as const,
      rows: integrity.missingDevices.map(m => `${TAB_LABELS[m.tab]} · ${formatMonthYear(m.month)} · ${m.deviceId}`)
    },
    {
      key: "invalidIds",
      icon: <ShieldAlert className="w-3.5 h-3.5" />,
      label: lang === "th" ? "รหัสอุปกรณ์ไม่ถูกต้อง" : "Invalid device IDs",
      count: integrity.invalidIds.length,
      severity: "error" as const,
      rows: integrity.invalidIds.map(i => `${TAB_LABELS[i.tab]} · row ${i.rowNumber} · "${i.rawId}"`)
    },
    {
      key: "blankRows",
      icon: <FileWarning className="w-3.5 h-3.5" />,
      label: lang === "th" ? "แถวที่ไม่มีเดือนกำกับ" : "Rows without a valid month",
      count: integrity.unexpectedBlankRows.length,
      severity: "error" as const,
      rows: integrity.unexpectedBlankRows.map(b => `${TAB_LABELS[b.tab]} · row ${b.rowNumber}`)
    }
  ];

  return (
    <div className="bg-slate-900 border border-slate-850 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`p-2 rounded-lg border ${
              healthy
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-amber-500/10 border-amber-500/20 text-amber-400"
            }`}
          >
            {healthy ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
          </span>
          <div>
            <h3 className="font-display font-semibold text-slate-100 text-sm">
              {lang === "th" ? "ศูนย์ตรวจสอบความถูกต้องของข้อมูล" : "Data Integrity Center"}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {lang === "th" ? "ตรวจสอบล่าสุด" : "Last validation"}:{" "}
              <span className="font-mono">{new Date(health.validatedAt).toISOString()}</span>
            </p>
          </div>
        </div>
        <button
          onClick={onValidate}
          disabled={isBusy}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-750 text-[11px] text-slate-200 font-semibold rounded-xl border border-slate-750 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-teal-400 ${isBusy ? "animate-spin" : ""}`} />
          <span>{lang === "th" ? "ตรวจสอบใหม่" : "Validate now"}</span>
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20" data-testid="integrity-display-period">
        <span className="text-[11px] text-slate-300 font-semibold">Global Data Display Period</span>
        <span className="text-xs font-mono font-bold text-amber-400">{displayPeriod}</span>
      </div>

      {/* Health summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            {lang === "th" ? "สถานะโครงสร้าง" : "Structure"}
          </p>
          <p className={`text-sm font-bold mt-1 ${health.structureOk ? "text-emerald-400" : "text-rose-400"}`}>
            {health.structureOk ? (lang === "th" ? "ถูกต้อง" : "Valid") : lang === "th" ? "มีปัญหา" : "Issues"}
          </p>
        </div>
        <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            {lang === "th" ? "จำนวนเดือน" : "Months"}
          </p>
          <p className="text-sm font-bold mt-1 text-slate-100 font-mono">
            {health.monthCount}
            <span className="text-[10px] text-slate-500 font-sans font-medium ml-1.5">
              {health.firstMonth && health.lastMonth ? `${formatMonthYear(health.firstMonth)} – ${formatMonthYear(health.lastMonth)}` : ""}
            </span>
          </p>
        </div>
        <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            {lang === "th" ? "ปัญหาที่ต้องแก้" : "Blocking issues"}
          </p>
          <p className={`text-sm font-bold mt-1 font-mono ${issueCount === 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {issueCount}
          </p>
        </div>
        <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            {lang === "th" ? "ข้อสังเกต" : "Advisories"}
          </p>
          <p className="text-sm font-bold mt-1 font-mono text-amber-400">
            {integrity.missingMonths.length + integrity.missingDevices.length}
          </p>
        </div>
      </div>

      {health.errors.length > 0 && (
        <div className="p-3 bg-rose-950/20 border border-rose-900/30 rounded-xl text-xs text-rose-300 space-y-1">
          {health.errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}
      {health.warnings.length > 0 && (
        <div className="p-3 bg-amber-950/20 border border-amber-900/30 rounded-xl text-xs text-amber-300 space-y-1">
          {health.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      {/* Finding sections */}
      <div className="space-y-2">
        {sections.map(section => (
          <div key={section.key} className="border border-slate-850 rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(expanded === section.key ? null : section.key)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-950/40 hover:bg-slate-950/70 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <span className={section.count === 0 ? "text-emerald-400" : section.severity === "error" ? "text-rose-400" : "text-amber-400"}>
                  {section.count === 0 ? <CheckCircle2 className="w-3.5 h-3.5" /> : section.icon}
                </span>
                {section.label}
              </span>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold font-mono ${
                  section.count === 0
                    ? "bg-emerald-500/10 text-emerald-400"
                    : section.severity === "error"
                      ? "bg-rose-500/10 text-rose-400"
                      : "bg-amber-500/10 text-amber-400"
                }`}
              >
                {section.count}
              </span>
            </button>
            {expanded === section.key && section.count > 0 && (
              <div className="px-4 py-3 bg-slate-950/60 border-t border-slate-850 max-h-48 overflow-y-auto space-y-1">
                {section.rows.slice(0, 200).map((row, i) => (
                  <p key={i} className="text-[11px] text-slate-400 font-mono">
                    {row}
                  </p>
                ))}
                {section.rows.length > 200 && (
                  <p className="text-[11px] text-slate-500 italic">… {section.rows.length - 200} more</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
