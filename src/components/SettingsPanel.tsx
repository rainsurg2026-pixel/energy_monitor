import React, { useEffect, useState } from "react";
import { formatNumber2 } from "../utils/numberFormatBridge";
import {
  Archive,
  Clock,
  FileSpreadsheet,
  FolderOpen,
  Globe,
  History,
  Info,
  Moon,
  RotateCcw,
  Save,
  Settings as SettingsIcon,
  Sun
} from "lucide-react";
import type { AppConfig, BackupEntry, DesktopBridge } from "../desktop";
import { DataSnapshot } from "../data/IDataProvider";
import { notify } from "./Toast";

interface SettingsPanelProps {
  bridge: DesktopBridge;
  appConfig: AppConfig;
  workbook: DataSnapshot | null;
  lang: "th" | "en";
  isBusy: boolean;
  onConfigChange: (config: AppConfig) => void;
  onRestoreBackup: (backupPath: string) => void;
  onOpenWorkbookDialog: () => void;
}

/**
 * Desktop settings: workbook & startup behavior, backups (list/restore),
 * auto-save, theme, language, optional Google Sheets sync, recent files,
 * and app info. Everything persists to config/config.json beside the exe.
 */
export default function SettingsPanel({
  bridge,
  appConfig,
  workbook,
  lang,
  isBusy,
  onConfigChange,
  onRestoreBackup,
  onOpenWorkbookDialog
}: SettingsPanelProps) {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<{ version: string; appRoot: string; portable: boolean } | null>(null);

  const th = lang === "th";

  useEffect(() => {
    void bridge.app.getInfo().then(info => setAppInfo(info));
  }, [bridge]);

  useEffect(() => {
    if (!workbook?.path) {
      setBackups([]);
      return;
    }
    void bridge.backups.list(workbook.path).then(result => {
      if (result.ok) setBackups((result as { ok: true; backups: BackupEntry[] }).backups);
    });
  }, [bridge, workbook?.path, workbook?.health?.validatedAt]);

  const update = (patch: Partial<AppConfig>) => {
    void bridge.config
      .update(patch)
      .then(onConfigChange)
      .catch(err => notify("error", `Could not save settings: ${err instanceof Error ? err.message : err}`));
  };

  const card = "bg-slate-900 border border-slate-850 rounded-2xl p-5 shadow-sm space-y-4";
  const heading = "font-display font-semibold text-slate-100 text-sm flex items-center gap-2";
  const label = "text-[11px] text-slate-400 font-semibold";
  const select =
    "bg-slate-950 text-slate-100 text-xs font-semibold border border-slate-800 rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer";
  const chipBtn = (active: boolean) =>
    `px-3 py-2 text-[11px] font-bold rounded-xl border transition-all cursor-pointer ${
      active
        ? "bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/15"
        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700"
    }`;

  const sizeLabel = (bytes: number) => bytes > 1024 * 1024 ? `${formatNumber2(bytes / 1024 / 1024)} MB` : `${formatNumber2(bytes / 1024)} KB`;

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* WORKBOOK & STARTUP */}
      <div className={card}>
        <h3 className={heading}>
          <FileSpreadsheet className="w-4 h-4 text-teal-400" />
          <span>{th ? "ไฟล์ Workbook และการเริ่มต้น" : "Workbook & Startup"}</span>
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <p className={label}>{th ? "ไฟล์เริ่มต้น (Default Workbook)" : "Default workbook"}</p>
            <div className="flex items-center gap-2">
              <span
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-300 font-mono truncate"
                title={appConfig.defaultWorkbookPath ?? undefined}
              >
                {appConfig.defaultWorkbookPath ?? (th ? "(ยังไม่ได้กำหนด)" : "(not set)")}
              </span>
              <button
                onClick={() => {
                  if (workbook?.path) update({ defaultWorkbookPath: workbook.path });
                }}
                disabled={!workbook?.path}
                className={chipBtn(false) + " disabled:opacity-40 shrink-0"}
                title={th ? "ใช้ไฟล์ที่เปิดอยู่" : "Use the currently open workbook"}
              >
                {th ? "ใช้ไฟล์ปัจจุบัน" : "Use current"}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={label}>{th ? "เมื่อเปิดโปรแกรม" : "On startup"}</p>
            <div className="flex gap-2">
              <button onClick={() => update({ startupBehavior: "last" })} className={chipBtn(appConfig.startupBehavior === "last")}>
                {th ? "เปิดไฟล์ล่าสุด" : "Open last file"}
              </button>
              <button onClick={() => update({ startupBehavior: "default" })} className={chipBtn(appConfig.startupBehavior === "default")}>
                {th ? "เปิดไฟล์เริ่มต้น" : "Open default"}
              </button>
              <button onClick={() => update({ startupBehavior: "ask" })} className={chipBtn(appConfig.startupBehavior === "ask")}>
                {th ? "ถามทุกครั้ง" : "Ask every time"}
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={onOpenWorkbookDialog} disabled={isBusy} className={chipBtn(false) + " flex items-center gap-1.5 disabled:opacity-40"}>
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
            {th ? "เปิดไฟล์อื่น..." : "Open another workbook…"}
          </button>
          {appConfig.recentFiles.length > 0 && (
            <button
              onClick={() => void bridge.config.clearRecent().then(onConfigChange)}
              className={chipBtn(false) + " flex items-center gap-1.5"}
            >
              <History className="w-3.5 h-3.5 text-slate-400" />
              {th ? `ล้างรายการไฟล์ล่าสุด (${appConfig.recentFiles.length})` : `Clear recent files (${appConfig.recentFiles.length})`}
            </button>
          )}
        </div>
      </div>

      {/* AUTO SAVE & BACKUP */}
      <div className={card}>
        <h3 className={heading}>
          <Save className="w-4 h-4 text-emerald-400" />
          <span>{th ? "บันทึกอัตโนมัติ และสำรองไฟล์" : "Auto Save & Backup"}</span>
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <p className={label}>{th ? "บันทึกอัตโนมัติทุก ๆ" : "Auto-save interval"}</p>
            <select
              value={appConfig.autoSaveIntervalMinutes}
              onChange={e => update({ autoSaveIntervalMinutes: Number(e.target.value) })}
              className={select + " w-full"}
            >
              <option value={0}>{th ? "ปิดใช้งาน" : "Disabled"}</option>
              {[1, 2, 5, 10, 15, 30, 60].map(m => (
                <option key={m} value={m}>
                  {m} {th ? "นาที" : "min"}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {th
                ? "บันทึกเฉพาะเมื่อมีการแก้ไขที่ยังไม่ถูกบันทึกเท่านั้น"
                : "Only writes when there are unsaved changes."}
            </p>
          </div>
          <div className="space-y-1.5">
            <p className={label}>{th ? "เก็บไฟล์สำรองล่าสุด" : "Backups to keep"}</p>
            <select value={appConfig.backupKeep} onChange={e => update({ backupKeep: Number(e.target.value) })} className={select + " w-full"}>
              {[5, 10, 20, 50, 100].map(n => (
                <option key={n} value={n}>
                  {n} {th ? "ไฟล์" : "files"}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              {th ? "สร้างไฟล์สำรองก่อนการบันทึกทุกครั้ง" : "A backup is created before every save."}
            </p>
          </div>
          <div className="space-y-1.5">
            <p className={label}>{th ? "โฟลเดอร์สำรองไฟล์" : "Backup folder"}</p>
            <div className="flex items-center gap-2">
              <span className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-300 font-mono truncate">
                {appConfig.backupFolder ?? (appInfo ? `${appInfo.appRoot}\\backup` : "backup/")}
              </span>
              {backups[0] && (
                <button
                  onClick={() => void bridge.shell.showItemInFolder(backups[0].path)}
                  className={chipBtn(false) + " shrink-0"}
                  title={th ? "เปิดโฟลเดอร์" : "Open folder"}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Backup list + restore */}
        <div className="space-y-2 pt-1">
          <p className={label + " flex items-center gap-1.5"}>
            <Archive className="w-3.5 h-3.5 text-slate-500" />
            {th ? "ไฟล์สำรองของ Workbook นี้" : "Backups of this workbook"} ({backups.length})
          </p>
          {backups.length === 0 && (
            <p className="text-[11px] text-slate-500 italic">
              {th ? "ยังไม่มีไฟล์สำรอง - จะถูกสร้างเมื่อบันทึกครั้งแรก" : "No backups yet - one is created on the first save."}
            </p>
          )}
          <div className="max-h-56 overflow-y-auto space-y-1.5">
            {backups.map(backup => (
              <div
                key={backup.path}
                className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-950/60 border border-slate-850 rounded-xl"
              >
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-300 font-mono truncate" title={backup.path}>
                    {backup.fileName}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {new Date(backup.createdAt).toISOString()} · {sizeLabel(backup.sizeBytes)}
                  </p>
                </div>
                {confirmRestore === backup.path ? (
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        setConfirmRestore(null);
                        onRestoreBackup(backup.path);
                      }}
                      className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-[10px] text-white font-bold rounded-lg cursor-pointer"
                    >
                      {th ? "ยืนยันกู้คืน" : "Confirm restore"}
                    </button>
                    <button
                      onClick={() => setConfirmRestore(null)}
                      className="px-2.5 py-1.5 bg-slate-800 text-[10px] text-slate-300 font-semibold rounded-lg cursor-pointer"
                    >
                      {th ? "ยกเลิก" : "Cancel"}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRestore(backup.path)}
                    disabled={isBusy}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-750 text-[10px] text-amber-400 font-bold rounded-lg cursor-pointer disabled:opacity-40 shrink-0"
                    title={
                      th
                        ? "แทนที่ Workbook ปัจจุบันด้วยไฟล์สำรองนี้ (ไฟล์ปัจจุบันจะถูกสำรองไว้ก่อน)"
                        : "Replace the current workbook with this backup (the current file is backed up first)"
                    }
                  >
                    <RotateCcw className="w-3 h-3" />
                    {th ? "กู้คืน" : "Restore"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* APPEARANCE & LANGUAGE */}
      <div className={card}>
        <h3 className={heading}>
          <SettingsIcon className="w-4 h-4 text-indigo-400" />
          <span>{th ? "ธีมและภาษา" : "Appearance & Language"}</span>
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <p className={label}>{th ? "ธีม" : "Theme"}</p>
            <div className="flex gap-2">
              <button onClick={() => update({ theme: "dark" })} className={chipBtn(appConfig.theme === "dark") + " flex items-center gap-1.5"}>
                <Moon className="w-3.5 h-3.5" /> {th ? "มืด" : "Dark"}
              </button>
              <button onClick={() => update({ theme: "light" })} className={chipBtn(appConfig.theme === "light") + " flex items-center gap-1.5"}>
                <Sun className="w-3.5 h-3.5" /> {th ? "สว่าง" : "Light"}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={label}>{th ? "ภาษาเริ่มต้น" : "Default language"}</p>
            <div className="flex gap-2">
              <button onClick={() => update({ language: "th" })} className={chipBtn(appConfig.language === "th")}>
                ภาษาไทย
              </button>
              <button onClick={() => update({ language: "en" })} className={chipBtn(appConfig.language === "en")}>
                English
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* GOOGLE SHEETS (OPTIONAL) */}
      <div className={card}>
        <h3 className={heading}>
          <Globe className="w-4 h-4 text-indigo-400" />
          <span>{th ? "Google Sheets (ตัวเลือกเสริม)" : "Google Sheets (optional)"}</span>
        </h3>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-[11px] text-slate-400 leading-relaxed max-w-lg">
            {th
              ? "ไฟล์ Excel คือฐานข้อมูลหลักของโปรแกรมนี้ หากเปิดใช้งาน Google Sheets แผงซิงก์จะปรากฏในหน้ากรอกข้อมูลเพื่อซิงก์ข้อมูลขึ้นคลาวด์เพิ่มเติม (ต้องต่ออินเทอร์เน็ต)"
              : "The Excel workbook is this app's primary database. Enabling Google Sheets shows the sync board on the entry page for additional cloud sync (requires internet)."}
          </p>
          <button
            onClick={() =>
              update({ googleSheets: { enabled: !appConfig.googleSheets.enabled, spreadsheetId: appConfig.googleSheets.spreadsheetId } })
            }
            className={chipBtn(appConfig.googleSheets.enabled) + " shrink-0"}
          >
            {appConfig.googleSheets.enabled ? (th ? "เปิดใช้งานอยู่" : "Enabled") : th ? "ปิดอยู่ - กดเพื่อเปิด" : "Disabled - click to enable"}
          </button>
        </div>
      </div>

      {/* APP INFO */}
      <div className={card}>
        <h3 className={heading}>
          <Info className="w-4 h-4 text-slate-400" />
          <span>{th ? "ข้อมูลโปรแกรม" : "About"}</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-400 font-mono">
          <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 font-sans font-bold uppercase tracking-wider">Version</p>
            <p className="mt-1 text-slate-200">v{appInfo?.version ?? "…"}</p>
          </div>
          <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3">
            <p className="text-[10px] text-slate-500 font-sans font-bold uppercase tracking-wider">Mode</p>
            <p className="mt-1 text-slate-200">{appInfo?.portable ? "Portable" : "Development"}</p>
          </div>
          <div className="bg-slate-950/60 border border-slate-850 rounded-xl p-3 sm:col-span-1 overflow-hidden">
            <p className="text-[10px] text-slate-500 font-sans font-bold uppercase tracking-wider">{th ? "โฟลเดอร์โปรแกรม" : "App folder"}</p>
            <p className="mt-1 text-slate-200 truncate" title={appInfo?.appRoot}>
              {appInfo?.appRoot ?? "…"}
            </p>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed flex items-center gap-1.5">
          <Clock className="w-3 h-3" />
          {th
            ? "ข้อมูลทั้งหมดถูกเก็บในโฟลเดอร์โปรแกรม (config/, backup/, logs/, exports/) - ไม่มีการเขียนลง AppData หรือ Registry"
            : "Everything is stored beside the executable (config/, backup/, logs/, exports/) - nothing is written to AppData or the registry."}
        </p>
      </div>
    </div>
  );
}
