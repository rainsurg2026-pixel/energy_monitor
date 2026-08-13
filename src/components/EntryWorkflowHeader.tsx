import React, { useMemo } from "react";
import { Building2, Calendar, ChevronLeft, ChevronRight, FileSpreadsheet, ShieldAlert, ShieldCheck } from "lucide-react";
import { CompletionSummary } from "../utils/completion";
import type { WorkbookHealth } from "../desktop";

interface EntryWorkflowHeaderProps {
  lang: "th" | "en";
  facilityName: string | null;
  facilityLogo: string | null;
  workbookLabel: string | null;
  months: string[]; // all existing months, ascending (YYYY-MM)
  selectedMonth: string;
  completion: CompletionSummary;
  health: WorkbookHealth | null;
  /** Timestamp of the last successful workbook save (GMT+7 formatted). */
  lastSaved: string | null;
  /** Selecting an existing month switches to it; a missing one asks to create it. */
  onSelectMonth: (month: string, exists: boolean) => void;
  /** Web mode has no workbook integrity probe, so it must not claim one. */
  showHealth?: boolean;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * RC2 workflow strip: Facility → Year → Month → Entry. Year and month are
 * dynamic dropdowns (months of the selected year only); missing months are
 * offered for creation; ◀ ▶ step through existing records chronologically.
 */
export default function EntryWorkflowHeader({
  lang,
  facilityName,
  facilityLogo,
  workbookLabel,
  months,
  selectedMonth,
  completion,
  health,
  lastSaved,
  onSelectMonth,
  showHealth = true
}: EntryWorkflowHeaderProps) {
  const th = lang === "th";
  const existing = useMemo(() => new Set(months), [months]);
  // Years are listed newest-first; the latest is what a user wants 99% of the time.
  const years = useMemo(() => {
    const ys = new Set(months.map(m => m.split("-")[0]));
    const selYear = selectedMonth?.split("-")[0];
    if (selYear) ys.add(selYear);
    ys.add(String(new Date().getFullYear()));
    return Array.from(ys).sort().reverse();
  }, [months, selectedMonth]);

  const selectedYear = selectedMonth?.split("-")[0] ?? years[0];

  // ◀ ▶ step calendar months (not just existing records), wrapping across
  // years: Jan 2026 ◀ = Dec 2025, Dec 2025 ▶ = Jan 2026. A missing target
  // month goes through the Create Monthly Record prompt.
  const stepMonth = (delta: 1 | -1) => {
    if (!selectedMonth) return;
    const [y, m] = selectedMonth.split("-").map(Number);
    if (!y || !m) return;
    const d = new Date(y, m - 1 + delta, 1);
    const target = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    onSelectMonth(target, existing.has(target));
  };

  const handleYearChange = (year: string) => {
    const inYear = months.filter(m => m.startsWith(`${year}-`));
    if (inYear.length > 0) {
      onSelectMonth(inYear[inYear.length - 1], true); // latest month of that year
    } else {
      onSelectMonth(`${year}-01`, false);
    }
  };

  const healthIssues = health
    ? health.duplicateCount + health.invalidIdCount + health.blankRowCount + (health.structureOk ? 0 : 1)
    : 0;

  const chip = "flex items-center gap-1.5 px-3 py-2 bg-slate-950/60 border border-slate-850 rounded-xl text-[11px] font-semibold text-slate-300";
  const selectCls =
    "bg-slate-950 text-slate-100 font-semibold font-mono text-xs border border-slate-800 rounded-xl pl-3 pr-7 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none";
  const stepBtn =
    "p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-default";

  const pctColor = completion.overall.percent >= 100 ? "text-emerald-400" : completion.overall.percent >= 50 ? "text-amber-400" : "text-rose-400";

  return (
    <section className="bg-slate-900 border border-slate-850 p-4 rounded-2xl shadow-sm flex flex-wrap items-center gap-3">
      {/* Facility */}
      {facilityName && (
        <span className={chip} title={th ? "ศูนย์ข้อมูลที่ใช้งาน" : "Active facility"}>
          <span className="text-sm leading-none">{facilityLogo ?? <Building2 className="w-3.5 h-3.5" />}</span>
          <span>{facilityName}</span>
        </span>
      )}

      {/* Workbook */}
      {workbookLabel && (
        <span className={chip} title={th ? "ไฟล์ฐานข้อมูล" : "Workbook"}>
          <FileSpreadsheet className="w-3.5 h-3.5 text-teal-400" />
          <span className="font-mono">{workbookLabel}</span>
        </span>
      )}

      <span className="text-slate-700 select-none hidden sm:inline">│</span>

      {/* Year */}
      <div className="relative">
        <select value={selectedYear} onChange={e => handleYearChange(e.target.value)} className={selectCls} title={th ? "เลือกปี" : "Year"}>
          {years.map(y => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-500">▼</span>
      </div>

      {/* Month (months of the selected year; missing ones offered for creation) */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => stepMonth(-1)}
          disabled={!selectedMonth}
          className={stepBtn}
          title={th ? "เดือนก่อนหน้า" : "Previous month"}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <div className="relative">
          <select
            value={selectedMonth}
            onChange={e => onSelectMonth(e.target.value, existing.has(e.target.value))}
            className={selectCls + " min-w-[150px]"}
            title={th ? "เลือกเดือน" : "Month"}
          >
            {!existing.has(selectedMonth) && (
              <option value={selectedMonth}>
                {MONTH_NAMES[parseInt(selectedMonth.split("-")[1], 10) - 1]} {selectedYear} ({th ? "ยังไม่มีข้อมูล" : "no record"})
              </option>
            )}
            {MONTH_NAMES.map((name, i) => {
              const value = `${selectedYear}-${String(i + 1).padStart(2, "0")}`;
              const has = existing.has(value);
              if (value === selectedMonth && !has) return null;
              return (
                <option key={value} value={value}>
                  {name} {selectedYear}
                  {has ? "" : th ? " (สร้างใหม่...)" : " (create…)"}
                </option>
              );
            })}
          </select>
          <Calendar className="w-3.5 h-3.5 text-indigo-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
        </div>
        <button
          onClick={() => stepMonth(1)}
          disabled={!selectedMonth}
          className={stepBtn}
          title={th ? "เดือนถัดไป" : "Next month"}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1" />

      {/* Last saved */}
      {lastSaved && (
        <span className={chip} title={th ? "บันทึกลงไฟล์ล่าสุด" : "Last saved to workbook"}>
          <span className="text-slate-500">{th ? "บันทึกล่าสุด" : "Last saved"}</span>
          <span className="font-mono">{lastSaved}</span>
        </span>
      )}

      {/* Completion */}
      <span className={chip} title={th ? "ความครบถ้วนของข้อมูลเดือนนี้" : "Data completion for this month"}>
        <span className={`font-mono font-bold ${pctColor}`}>{completion.overall.percent}%</span>
        <span className="text-slate-500">
          {completion.overall.filled}/{completion.overall.total} {th ? "ช่อง" : "fields"}
        </span>
      </span>

      {/* Health */}
      {showHealth && <span
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border ${
          healthIssues === 0
            ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
            : "bg-amber-500/10 border-amber-500/25 text-amber-400"
        }`}
        title={th ? "สุขภาพไฟล์ Workbook (ดูรายละเอียดในแท็บ 4)" : "Workbook health (details in tab 4)"}
      >
        {healthIssues === 0 ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
        {healthIssues === 0 ? (th ? "ปกติ" : "Healthy") : `${healthIssues} ${th ? "ปัญหา" : "issues"}`}
      </span>}
    </section>
  );
}
