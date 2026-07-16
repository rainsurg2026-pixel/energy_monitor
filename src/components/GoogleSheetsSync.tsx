import React, { useState, useEffect, useRef } from "react";
import {
  FileSpreadsheet,
  RefreshCw,
  Link2,
  Link2Off,
  CheckCircle,
  AlertCircle,
  Download,
  Upload,
  Clock,
  ArrowRight,
  ExternalLink
} from "lucide-react";
import {
  googleSignIn,
  logout
} from "../firebaseAuth";
import {
  writeMonthlyLogTransactional,
  VerificationFailedError,
  DataIntegrityReport
} from "../sheetsService";
import { loadAllLogs } from "../utils";
import { MonthlyLog } from "../types";

interface GoogleSheetsSyncProps {
  activeLog: MonthlyLog | null;
  lang: "th" | "en";
  // Authentication state now owned exclusively by App.tsx's single auth listener.
  isGoogleConnected: boolean;
  googleUserEmail: string | null;
  accessToken: string | null;
  // Spreadsheet Selection stage - single source of truth lives in App.tsx.
  spreadsheetId: string;
  onSpreadsheetIdChange: (id: string) => void;
  lastSyncedTime: string | null;
  // Delegates the actual import to App.tsx's single shared pipeline
  // (the only function in the app that calls importLogsFromGoogleSheets).
  // Resolves to null if this particular request was superseded/cancelled by a
  // newer one before it could complete.
  onImport: () => Promise<MonthlyLog[] | null>;
}

export default function GoogleSheetsSync({
  activeLog,
  lang,
  isGoogleConnected,
  googleUserEmail,
  accessToken,
  spreadsheetId,
  onSpreadsheetIdChange,
  lastSyncedTime,
  onImport
}: GoogleSheetsSyncProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [loginErrorMessage, setLoginErrorMessage] = useState<string | null>(null);

  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Track if we should automatically sync to Google Sheets whenever local Save is clicked
  const [autoSync, setAutoSync] = useState(() => {
    const saved = localStorage.getItem("google_sheets_auto_sync");
    return saved !== null ? saved === "true" : true; // Default to true!
  });

  const handleAutoSyncToggle = (checked: boolean) => {
    setAutoSync(checked);
    localStorage.setItem("google_sheets_auto_sync", checked ? "true" : "false");
  };

  const handleLogin = async () => {
    setIsConnecting(true);
    setLoginErrorMessage(null);
    try {
      await googleSignIn();
      // Firebase's auth-state listener (owned by App.tsx) will pick up the new
      // session and flow isGoogleConnected/googleUserEmail/accessToken down as props.
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || String(err);
      const isPopupClosed = errMsg.includes("popup-closed-by-user") || errMsg.includes("cancelled-popup-request") || errMsg.includes("popup_closed_by_user");
      if (isPopupClosed) {
        setLoginErrorMessage(
          lang === "th"
            ? "ป๊อปอัปถูกปิดกั้นหรือถูกปิดลงเนื่องจากข้อจำกัดความปลอดภัยของเบราว์เซอร์ในการแสดงผลผ่านหน้าต่างพรีวิว (iFrame) ของ AI Studio กรุณากดเปิดแอปในหน้าต่างใหม่ (ปุ่มสีม่วง 'เปิดแอปในแท็บใหม่' ด้านล่าง) เพื่อเข้าสู่ระบบและได้รับสิทธิการเข้าถึงอย่างสมบูรณ์"
            : "Google Sign-In popup was blocked or closed due to AI Studio iframe sandbox restrictions. Please click 'Open App in New Tab' (the indigo button below) to sign in safely in a separate window."
        );
      } else {
        setLoginErrorMessage(
          lang === "th"
            ? `การเชื่อมต่อ Google บัญชีล้มเหลว: ${errMsg}`
            : `Google Authentication connection failed: ${errMsg}`
        );
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      // Firebase's auth-state listener (owned by App.tsx) will detect the sign-out
      // and flow isGoogleConnected=false/accessToken=null down as props.
    } catch (err) {
      console.error(err);
    }
  };

  // Write concurrency guard: cancelling a write mid-flight is unsafe (the PATCH
  // may already be applied server-side even if we stop waiting for it), so
  // overlapping write triggers are serialized/queued instead - the next one
  // always waits for the current write's full Download->...->Verify cycle to
  // finish (success or failure) before it starts its own.
  const writeQueueRef = useRef<Promise<any>>(Promise.resolve());
  const enqueueWrite = <T,>(task: () => Promise<T>): Promise<T> => {
    const run = writeQueueRef.current.then(task, task);
    writeQueueRef.current = run.then(() => undefined, () => undefined);
    return run;
  };

  // Shared error-message resolver so a failed verification is always reported
  // as a distinct, unambiguous failure - never conflated with a generic error,
  // and never silently treated as success.
  const describeWriteError = (err: any): string => {
    if (err instanceof VerificationFailedError) {
      return lang === "th"
        ? "ไม่สามารถตรวจสอบยืนยันข้อมูลที่อัปโหลดได้ ข้อมูลของคุณอาจไม่ถูกบันทึกอย่างสมบูรณ์ กรุณาลองซิงค์อีกครั้ง"
        : "Upload could not be verified — your data may not have been fully saved. Please retry the sync.";
    }
    return err?.message || "Sync failed.";
  };

  // Non-fatal Data Integrity Report findings are logged for visibility (duplicate
  // keys are NOT included here - those already stop synchronization outright).
  const logIntegrityReport = (report: DataIntegrityReport) => {
    const { missingMonths, missingDevices, unexpectedBlankRows, invalidIds } = report;
    if (missingMonths.length || missingDevices.length || unexpectedBlankRows.length || invalidIds.length) {
      console.warn("Google Sheets data integrity report:", {
        missingMonths, missingDevices, unexpectedBlankRows, invalidIds
      });
    }
  };

  // Local ordering guard so this card's own status pill can never be clobbered
  // by an older, since-superseded call finishing after a newer one already did
  // (e.g. rapid clicks across Sync Active Month / Export All / Import All).
  const localImportSeqRef = useRef(0);

  /**
   * Local wrapper around the shared import pipeline: preserves this card's own
   * idle/syncing/success/error status pill and the "no valid rows" validation
   * message exactly as before, while delegating the actual network + store work
   * to the single shared onImport() function owned by App.tsx.
   */
  const performImport = async () => {
    const mySeq = ++localImportSeqRef.current;
    setSyncStatus("syncing");
    setErrorMessage(null);

    try {
      const importedLogs = await onImport();

      // A newer local action has since taken over - don't touch the pill.
      if (mySeq !== localImportSeqRef.current) return;

      if (importedLogs === null) {
        // Superseded by a newer import elsewhere (e.g. spreadsheet change, or
        // another trigger firing first) - defer silently, no error to show.
        setSyncStatus("idle");
        return;
      }

      if (importedLogs.length === 0) {
        throw new Error(
          lang === "th"
            ? "ไม่พบข้อมูลดิบในสเปรดชีต กรุณาตรวจสอบว่าข้อมูลและหัวตารางถูกต้อง"
            : "No valid rows found in the Google Sheet. Please check your data headers."
        );
      }

      setSyncStatus("success");
      setTimeout(() => {
        if (mySeq === localImportSeqRef.current) setSyncStatus("idle");
      }, 4000);
    } catch (err: any) {
      if (mySeq !== localImportSeqRef.current) return;
      console.error(err);
      setSyncStatus("error");
      setErrorMessage(err.message || "Import failed.");
    }
  };

  /**
   * Export all local database records to Google Sheets: one transactional
   * write per month, in order. If any month fails verification, the loop
   * stops immediately (months already committed stay committed; nothing
   * after the failure is silently attempted).
   */
  const handleExportAllToSheets = async () => {
    if (!accessToken) return;
    await enqueueWrite(async () => {
      setSyncStatus("syncing");
      setErrorMessage(null);

      try {
        const allLogs = loadAllLogs();
        if (allLogs.length === 0) {
          throw new Error(lang === "th" ? "ไม่พบข้อมูลสำหรับส่งออก" : "No local data to export.");
        }

        for (const log of allLogs) {
          try {
            const { report } = await writeMonthlyLogTransactional(accessToken, spreadsheetId, log);
            logIntegrityReport(report);
          } catch (err: any) {
            // Stop at the first failing month - never continue past a failed write.
            if (err instanceof VerificationFailedError) {
              throw new VerificationFailedError(`${log.month}: ${err.message}`, err.mismatches);
            }
            throw new Error(`${log.month}: ${err?.message || "Sync failed."}`);
          }
        }

        // Pull latest from Google Sheets to ensure report state is 100% correct and synced
        await performImport();
      } catch (err: any) {
        console.error(err);
        setSyncStatus("error");
        setErrorMessage(describeWriteError(err));
      }
    });
  };

  /**
   * Sync ONLY the active month's data to Google Sheets using the transactional
   * write pipeline (Download -> Normalize -> Index -> Diff -> Patch -> Upload
   * -> Verify -> Commit). Only rows that actually changed are uploaded.
   */
  const handleSyncActiveMonth = async () => {
    if (!accessToken || !activeLog) return;
    await enqueueWrite(async () => {
      setSyncStatus("syncing");
      setErrorMessage(null);

      try {
        const { report } = await writeMonthlyLogTransactional(accessToken, spreadsheetId, activeLog);
        logIntegrityReport(report);

        // Pull latest from Google Sheets to ensure report state is 100% correct and synced
        await performImport();
      } catch (err: any) {
        console.error(err);
        setSyncStatus("error");
        setErrorMessage(describeWriteError(err));
      }
    });
  };

  /**
   * Import all rows from Google Sheets, replace local database, and refresh UI
   */
  const handleImportFromSheets = async () => {
    if (!accessToken) return;
    const confirmImport = window.confirm(
      lang === "th"
        ? "คุณแน่ใจหรือไม่ที่จะนำเข้าข้อมูลจาก Google Sheets? การทำงานนี้จะเขียนทับข้อมูลในเครื่องของคุณด้วยข้อมูลทั้งหมดจากสเปรดชีต"
        : "Are you sure you want to import from Google Sheets? This will overwrite your local database with the spreadsheet values."
    );
    if (!confirmImport) return;
    await performImport();
  };

  // Auto-sync function whenever the activeLog is saved and autoSync is enabled
  useEffect(() => {
    if (autoSync && accessToken && activeLog && (activeLog.lastSavedUps || activeLog.lastSavedAir || activeLog.lastSavedDc || activeLog.lastSavedEnergyCost)) {
      // Run automatic background sync for the active month through the same
      // transactional pipeline, queued behind any other in-flight write.
      enqueueWrite(async () => {
        try {
          const { report } = await writeMonthlyLogTransactional(accessToken, spreadsheetId, activeLog);
          logIntegrityReport(report);
          // Auto-import to keep report state 100% accurate
          await performImport();
        } catch (err) {
          console.error("Auto sync background error:", err);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLog, autoSync, accessToken]);

  const dict = {
    th: {
      cardTitle: "ซิงโครไนซ์กับ Google Sheets",
      cardDesc: "บันทึกข้อมูลและดึงประวัติการใช้ไฟฟ้า/เครื่องควบคุมจากสเปรดชีตโดยตรง",
      connectBtn: "เชื่อมต่อ Google Account",
      connectedAs: "เชื่อมต่อแล้วโดย",
      disconnectBtn: "ยกเลิกการเชื่อมต่อ",
      spreadsheetIdLabel: "ลิงก์หรือรหัส Google Spreadsheet ID",
      openSheet: "เปิด Google Sheets",
      syncActiveBtn: "ซิงค์ข้อมูลเดือนนี้ขึ้นสเปรดชีต",
      exportAllBtn: "ส่งออกข้อมูลทุกเดือนไปสเปรดชีต",
      importAllBtn: "นำเข้าข้อมูลทั้งหมดเข้าเครื่อง",
      autoSyncLabel: "เปิดระบบซิงค์ข้อมูลอัตโนมัติเมื่อกดบันทึก",
      lastSyncText: "ซิงค์ล่าสุดเวลา",
      syncStatusIdle: "พร้อมทำงาน",
      syncStatusSyncing: "กำลังเขียนข้อมูลสเปรดชีต...",
      syncStatusSuccess: "ซิงโครไนซ์ข้อมูลสำเร็จแล้ว!",
      syncStatusError: "เกิดข้อผิดพลาดในการซิงโครไนซ์",
      helperNote: "ข้อมูลในสเปรดชีตจะถูกแยกออกเป็น 4 แผ่นงานอัตโนมัติ: UPS Loads, Air Conditioning, DC Power Panels, และ Energy & Cost ต่อท้ายจากข้อมูลเดิมของคุณเพื่อความต่อเนื่องอย่างแม่นยำ"
    },
    en: {
      cardTitle: "Google Sheets Core Sync",
      cardDesc: "Direct real-time synchronization with cloud spreadsheet for durable metrics archive.",
      connectBtn: "Sign in with Google",
      connectedAs: "Connected as",
      disconnectBtn: "Disconnect",
      spreadsheetIdLabel: "Target Google Spreadsheet ID",
      openSheet: "Open Google Sheet",
      syncActiveBtn: "Sync Active Month Data",
      exportAllBtn: "Export Entire Database to Sheet",
      importAllBtn: "Import Spreadsheet Data",
      autoSyncLabel: "Enable Background Auto-Sync on Save",
      lastSyncText: "Last Synced at",
      syncStatusIdle: "Idle / Connected",
      syncStatusSyncing: "Updating Google Spreadsheet values...",
      syncStatusSuccess: "Google Sheets Sync Successful!",
      syncStatusError: "Sync Connection Error",
      helperNote: "Automatically segments facility metrics into 4 targeted worksheets: UPS Loads, Air Conditioning, DC Power Panels, and Energy & Cost without duplicates."
    }
  };

  const t = dict[lang];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-slate-800/60">
        <div>
          <h3 className="font-display font-semibold text-slate-100 text-sm flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>{t.cardTitle}</span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            {t.cardDesc}
          </p>
        </div>

        {/* CONNECTION STATUS */}
        <div>
          {!isGoogleConnected ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-slate-950 border border-slate-850 text-[10px] font-bold text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse"></span>
              {lang === "th" ? "ยังไม่ได้เชื่อมต่อ" : "Not Connected"}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-slate-400">
                {t.connectedAs}: <strong className="text-emerald-400 font-medium">{googleUserEmail}</strong>
              </span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-[10px] text-rose-400 font-bold rounded-lg border border-slate-750 cursor-pointer"
              >
                <Link2Off className="w-3 h-3" />
                <span>{t.disconnectBtn}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* iFrame Notice and sign-in button when not connected */}
      {!isGoogleConnected && (
        <div className="bg-slate-950/60 border border-slate-850 p-4 rounded-xl space-y-3">
          <div className="flex items-start gap-2.5 text-xs text-slate-300">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-400">
                {lang === "th" ? "คำแนะนำสำหรับการทดสอบผ่านระบบ AI Studio (iFrame)" : "AI Studio Preview Iframe Notice"}
              </p>
              <p className="text-slate-400 leading-relaxed">
                {lang === "th"
                  ? "เนื่องจากข้อจำกัดด้านความปลอดภัยของเบราว์เซอร์ในการแสดงผลผ่านหน้าต่างย่อย (iFrame) ป๊อปอัปเข้าสู่ระบบของ Google อาจปิดตัวลงโดยอัตโนมัติ เพื่อการเชื่อมต่อที่ราบรื่น แนะนำให้กดเปิดแอปในหน้าต่างใหม่ (แท็บแยก) เพื่อล็อกอินก่อน"
                  : "Due to browser security policies regarding embedded iframes, Google Sign-In popups might get blocked or closed automatically. We highly recommend opening the app in a new tab to authenticate securely."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5 pt-1">
            <button
              onClick={handleLogin}
              disabled={isConnecting}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-xs text-white font-bold rounded-xl transition-all shadow-md shadow-emerald-600/10 cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{isConnecting ? (lang === "th" ? "กำลังเชื่อมต่อ..." : "Connecting...") : t.connectBtn}</span>
            </button>
            <a
              href={window.location.origin}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 bg-indigo-650 hover:bg-indigo-600 text-xs text-white font-bold rounded-xl transition-all border border-indigo-500/30 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-indigo-300" />
              <span>{lang === "th" ? "เปิดแอปในแท็บใหม่" : "Open App in New Tab"}</span>
            </a>
          </div>
        </div>
      )}

      {/* Login error display when not connected */}
      {!isGoogleConnected && loginErrorMessage && (
        <div className="bg-rose-500/10 border border-rose-500/20 p-3.5 rounded-xl flex items-start gap-2.5 text-rose-300 text-xs font-sans animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">{lang === "th" ? "การเชื่อมต่อผิดพลาด" : "Connection Error"}</p>
            <p className="text-rose-400/90 leading-relaxed font-mono text-[11px]">{loginErrorMessage}</p>
          </div>
        </div>
      )}

      {/* SPREADSHEET INPUT LINK AND CONTROL MATRIX */}
      {isGoogleConnected && (
        <div className="space-y-4 animate-fadeIn">
          {/* Spreadsheet ID Input & Quick Link */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-8 space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                {t.spreadsheetIdLabel}
              </label>
              <input
                type="text"
                value={spreadsheetId}
                onChange={(e) => onSpreadsheetIdChange(e.target.value)}
                className="w-full bg-slate-950 text-slate-200 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-2.5 text-xs font-mono focus:outline-none"
                placeholder="Google Spreadsheet ID"
              />
            </div>

            <div className="md:col-span-4">
              <a
                href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`}
                target="_blank"
                rel="noreferrer"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 text-xs text-slate-300 rounded-xl transition-all font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
                <span>{t.openSheet}</span>
              </a>
            </div>
          </div>

          {/* Sync Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            {/* Sync Active Month */}
            <button
              onClick={handleSyncActiveMonth}
              disabled={syncStatus === "syncing" || !activeLog}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-750 text-xs text-slate-200 font-bold rounded-xl border border-slate-750 transition-all cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t.syncActiveBtn}</span>
            </button>

            {/* Export All */}
            <button
              onClick={handleExportAllToSheets}
              disabled={syncStatus === "syncing"}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-750 text-xs text-slate-200 font-bold rounded-xl border border-slate-750 transition-all cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-teal-400" />
              <span>{t.exportAllBtn}</span>
            </button>

            {/* Import All */}
            <button
              onClick={handleImportFromSheets}
              disabled={syncStatus === "syncing"}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-750 text-xs text-slate-200 font-bold rounded-xl border border-slate-750 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t.importAllBtn}</span>
            </button>
          </div>

          {/* Background Auto-Sync Option */}
          <div className="flex items-center justify-between p-3.5 bg-slate-950/60 rounded-xl border border-slate-850">
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-emerald-500" />
              <label htmlFor="auto-sync" className="text-xs font-semibold text-slate-300 cursor-pointer select-none">
                {t.autoSyncLabel}
              </label>
            </div>
            <input
              id="auto-sync"
              type="checkbox"
              checked={autoSync}
              onChange={(e) => handleAutoSyncToggle(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 bg-slate-900 border-slate-800 focus:ring-emerald-500 cursor-pointer"
            />
          </div>

          {/* Sync status logger */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono pt-1">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${
                syncStatus === "syncing" ? "bg-amber-400 animate-ping" :
                syncStatus === "success" ? "bg-emerald-400 animate-pulse" :
                syncStatus === "error" ? "bg-rose-400" : "bg-slate-500"
              }`} />
              <span className="text-slate-300">
                Status: {
                  syncStatus === "syncing" ? t.syncStatusSyncing :
                  syncStatus === "success" ? t.syncStatusSuccess :
                  syncStatus === "error" ? `${t.syncStatusError} (${errorMessage})` :
                  t.syncStatusIdle
                }
              </span>
            </div>

            {lastSyncedTime && (
              <span className="text-slate-400 text-[10px]">
                {t.lastSyncText}: <strong className="text-slate-200">{lastSyncedTime}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Helpful Instructions */}
      <p className="text-[11px] text-slate-400 bg-slate-950/40 p-3.5 rounded-xl border border-slate-850/60 leading-relaxed font-sans">
        💡 {t.helperNote}
      </p>
    </div>
  );
}
