import React from "react";
import { Building2, HardDrive, Lock, PenLine, ShieldAlert, ShieldCheck, Wifi, WifiOff } from "lucide-react";

interface StatusBarProps {
  lang: "th" | "en";
  facilityName: string | null;
  workbookLabel: string | null;
  selectedMonth: string; // YYYY-MM ("" when none)
  provider: string;
  /** null = unknown yet; true = writable; false = read-only mode. */
  writable: boolean | null;
  healthPercent: number | null;
  integrityIssues: number | null;
  /** RC3: live completion of the selected month's record (0-100). */
  completionPercent?: number | null;
  lastSaved: string | null;
  online: boolean;
  version: string | null;
}

/**
 * RC2: always-visible desktop status bar - facility, workbook, period,
 * provider, access mode, health, integrity, last saved, offline, version.
 */
export default function StatusBar({
  lang,
  facilityName,
  workbookLabel,
  selectedMonth,
  provider,
  writable,
  healthPercent,
  integrityIssues,
  completionPercent = null,
  lastSaved,
  online,
  version
}: StatusBarProps) {
  const th = lang === "th";
  const [year, month] = selectedMonth ? selectedMonth.split("-") : [null, null];

  const item = "flex items-center gap-1 whitespace-nowrap";
  const dim = "text-slate-500";

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 h-[26px] bg-slate-950 border-t border-slate-800 text-[10px] font-mono text-slate-400 select-none">
      <div className="h-full px-3 flex items-center gap-3 overflow-x-auto">
        {facilityName && (
          <span className={item} title={th ? "ศูนย์ข้อมูล" : "Facility"}>
            <Building2 className="w-3 h-3 text-indigo-400" />
            {facilityName}
          </span>
        )}
        {workbookLabel && (
          <span className={item} title={th ? "ไฟล์ฐานข้อมูล" : "Workbook"}>
            <HardDrive className="w-3 h-3 text-teal-400" />
            {workbookLabel}
          </span>
        )}
        {year && (
          <span className={item} title={th ? "ปี / เดือน" : "Year / Month"}>
            <span className={dim}>{th ? "ปี" : "Y"}</span> {year} <span className={dim}>{th ? "เดือน" : "M"}</span> {month}
          </span>
        )}
        <span className={item} title="Provider">
          <span className={dim}>Provider</span> {provider}
        </span>
        {writable !== null && (
          <span
            className={`${item} font-bold ${writable ? "text-emerald-400" : "text-rose-400"}`}
            title={th ? "โหมดการเข้าถึงไฟล์" : "Access mode"}
          >
            {writable ? <PenLine className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
            {writable ? "Read / Write" : th ? "อ่านอย่างเดียว" : "Read Only"}
          </span>
        )}
        {healthPercent !== null && (
          <span
            className={`${item} font-bold ${healthPercent >= 100 ? "text-emerald-400" : healthPercent >= 60 ? "text-amber-400" : "text-rose-400"}`}
            title={th ? "สุขภาพไฟล์ Workbook" : "Workbook health"}
          >
            {healthPercent >= 100 ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
            {healthPercent}%
          </span>
        )}
        {integrityIssues !== null && (
          <span
            className={`${item} ${integrityIssues === 0 ? "text-emerald-400" : "text-amber-400"}`}
            title={th ? "ผลตรวจสอบความถูกต้องของข้อมูล" : "Data integrity"}
          >
            <span className={dim}>Integrity</span>
            {integrityIssues === 0 ? (th ? "ปกติ" : "OK") : `${integrityIssues} ${th ? "ปัญหา" : "issues"}`}
          </span>
        )}
        {completionPercent !== null && (
          <span
            className={`${item} ${completionPercent >= 100 ? "text-emerald-400" : "text-amber-400"}`}
            title={th ? "ความครบถ้วนของข้อมูลเดือนที่เลือก" : "Selected month's data completion"}
          >
            <span className={dim}>{th ? "ครบถ้วน" : "Completion"}</span>
            {completionPercent}%
          </span>
        )}

        <span className="flex-1" />

        {lastSaved && (
          <span className={item} title={th ? "บันทึกล่าสุด" : "Last saved"}>
            <span className={dim}>{th ? "บันทึกล่าสุด" : "Saved"}</span> {lastSaved}
          </span>
        )}
        <span className={item} title={th ? "แอปทำงานแบบออฟไลน์ได้เต็มรูปแบบ" : "The app is fully offline-capable"}>
          {online ? <Wifi className="w-3 h-3 text-slate-500" /> : <WifiOff className="w-3 h-3 text-amber-400" />}
          {online ? "Online" : "Offline"}
        </span>
        {version && (
          <span className={item} title={th ? "เวอร์ชันโปรแกรม" : "App version"}>
            v{version}
          </span>
        )}
      </div>
    </div>
  );
}
