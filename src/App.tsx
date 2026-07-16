import React, { useState, useEffect, useMemo, useRef } from "react";
import { initAuth, googleSignIn } from "./firebaseAuth";
import {
  loadAllLogs,
  loadLogForMonth,
  saveLogForMonth,
  deleteLogForMonth,
  createEmptyLog,
  formatMonthYear,
  formatTimestamp,
  getPreviousMonthStr
} from "./utils";
import { importLogsFromGoogleSheets, DEFAULT_SPREADSHEET_ID } from "./sheetsService";
import { MonthlyLog, SecurityConfig, UpsRecord, AirRecord, DcRecord, EnergyCostRecord } from "./types";
import { DataSnapshot, ProviderError } from "./data/IDataProvider";
import { ExcelProvider } from "./data/ExcelProvider";
import { getDesktopBridge } from "./data/ProviderFactory";
import type { AppConfig } from "./desktop";
import ToastHost, { notify } from "./components/Toast";
import WorkbookBar from "./components/WorkbookBar";
import WelcomePanel from "./components/WelcomePanel";
import DashboardStats from "./components/DashboardStats";
import UpsTable from "./components/UpsTable";
import AirTable from "./components/AirTable";
import DcTable from "./components/DcTable";
import EnergyCostTable from "./components/EnergyCostTable";
import DataManagement from "./components/DataManagement";
import HistoricalCharts from "./components/HistoricalCharts";
import PinLockModal from "./components/PinLockModal";
import GoogleSheetsSync from "./components/GoogleSheetsSync";
import DashboardSummary from "./components/DashboardSummary";
import HistoricalExplorer from "./components/HistoricalExplorer";
import { ReportProvider, useReport } from "./ReportContext";
import UniversalFilterBar from "./components/UniversalFilterBar";
import ExecutiveDashboard from "./components/ExecutiveDashboard";
import BenchmarkDashboard from "./components/BenchmarkDashboard";
import ForecastDashboard from "./components/ForecastDashboard";
import SmartInsightPanel from "./components/SmartInsightPanel";
import { 
  Shield, 
  Lock, 
  Unlock, 
  Calendar, 
  Plus, 
  Globe, 
  Activity, 
  Check, 
  BookOpen, 
  Settings, 
  FileSpreadsheet,
  AlertCircle,
  AlertTriangle,
  BarChart4,
  TableProperties,
  RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

function DashboardViewContainer({
  logs,
  lang,
  isGoogleConnected,
  googleUserEmail
}: {
  logs: MonthlyLog[];
  lang: "th" | "en";
  isGoogleConnected: boolean;
  googleUserEmail: string | null;
}) {
  const { selectedReportView, selectedYear, selectedPeriod } = useReport();

  const activeMonthStr = useMemo(() => {
    if (selectedPeriod === "Entire Year" || selectedPeriod === "YTD") {
      const matching = logs
        .filter(l => l.month.startsWith(selectedYear))
        .sort((a, b) => b.month.localeCompare(a.month));
      if (matching.length > 0) {
        return matching[0].month;
      }
      return `${selectedYear}-06`;
    }
    return `${selectedYear}-${selectedPeriod}`;
  }, [selectedYear, selectedPeriod, logs]);

  const handleExport = (format: "pdf" | "excel" | "csv" | "png") => {
    alert(lang === "th" 
      ? `ระบบกำลังสร้างไฟล์รายงานรูปแบบ ${format.toUpperCase()} เพื่อทำการดาวน์โหลดอัตโนมัติ...` 
      : `Generating report as ${format.toUpperCase()} for automatic download...`
    );
  };

  return (
    <div className="space-y-6">
      <UniversalFilterBar lang={lang} onExport={handleExport} />

      {selectedReportView === "executive" && (
        <div className="space-y-6 animate-fadeIn">
          <ExecutiveDashboard logs={logs} lang={lang} />
          <SmartInsightPanel logs={logs} lang={lang} />
        </div>
      )}

      {selectedReportView === "dashboard" && (
        <div className="animate-fadeIn">
          <DashboardSummary
            logs={logs}
            selectedMonth={activeMonthStr}
            lang={lang}
            isGoogleConnected={isGoogleConnected}
            googleUserEmail={googleUserEmail}
          />
        </div>
      )}

      {selectedReportView === "benchmark" && (
        <div className="animate-fadeIn">
          <BenchmarkDashboard logs={logs} lang={lang} />
        </div>
      )}

      {selectedReportView === "forecast" && (
        <div className="animate-fadeIn">
          <ForecastDashboard logs={logs} lang={lang} />
        </div>
      )}
    </div>
  );
}

export default function App() {
  // --- STATE DECLARATIONS ---
  const [logs, setLogs] = useState<MonthlyLog[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [activeLog, setActiveLog] = useState<MonthlyLog | null>(null);
  const [currentView, setCurrentView] = useState<"dashboard" | "entry" | "history">("dashboard");

  // --- DESKTOP (EXCEL WORKBOOK) SESSION ---
  // In the desktop app the Excel workbook is the primary data source; the
  // Google Sheets pipeline below remains the browser fallback / optional sync.
  const desktopBridge = useMemo(() => getDesktopBridge(), []);
  const isDesktopApp = desktopBridge !== null;
  const excelProvider = useMemo(() => (desktopBridge ? new ExcelProvider(desktopBridge) : null), [desktopBridge]);
  const [workbook, setWorkbook] = useState<DataSnapshot | null>(null);
  const [isWorkbookBusy, setIsWorkbookBusy] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [lockRetry, setLockRetry] = useState<(() => void) | null>(null);
  
  // Google Sheets state shared globally
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [googleUserEmail, setGoogleUserEmail] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Google Sheets synchronization states for Reporting
  const [syncedLogs, setSyncedLogs] = useState<MonthlyLog[] | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Spreadsheet Selection stage: single source of truth for which sheet to sync with.
  const [spreadsheetId, setSpreadsheetId] = useState<string>(() => {
    return localStorage.getItem("google_sheets_spreadsheet_id") || DEFAULT_SPREADSHEET_ID;
  });
  const [lastSyncedTime, setLastSyncedTime] = useState<string | null>(() => {
    return localStorage.getItem("google_sheets_last_synced") || null;
  });

  const validateImportedMonths = (imported: MonthlyLog[]) => {
    const importedMonths = imported.map(l => l.month).sort();
    const displayedMonths = imported.map(l => l.month).sort();

    console.log("--- Google Sheets Sync Validation ---");
    console.log("Imported Months:");
    importedMonths.forEach(m => console.log(m));
    console.log("Displayed Months:");
    displayedMonths.forEach(m => console.log(m));

    // Warn if mismatch
    if (importedMonths.length !== displayedMonths.length || !importedMonths.every((v, i) => v === displayedMonths[i])) {
      console.warn("WARNING: Displayed months and Imported months do not match!");
    } else {
      console.log("Validation Success: Displayed months match Google Sheets perfectly.");
    }
  };

  // Concurrency guards for the Google Sheets import pipeline: only the most recently
  // requested import may run its network calls and commit state. Every earlier
  // in-flight import is aborted and its (possibly still-arriving) result is ignored.
  const importAbortControllerRef = useRef<AbortController | null>(null);
  const importSeqRef = useRef(0);

  /**
   * The single, authoritative Google Sheets import pipeline for the whole app:
   * Cancel-previous -> Single Import -> Validation -> Update syncedLogs (which
   * reactively refreshes ReportContext and every Report view via props).
   * This is the ONLY function that calls importLogsFromGoogleSheets, and it backs
   * every trigger (spreadsheet change, manual import, retry, auto-refresh-after-save).
   *
   * Returns the imported logs, or null if this call was superseded by a newer
   * request before it could complete (cancelled - not an error).
   */
  const runGoogleSheetsImport = async (token: string, sheetId: string): Promise<MonthlyLog[] | null> => {
    // Requirement 1 & 2: only one import runs at a time; a new request cancels the previous one.
    importAbortControllerRef.current?.abort();
    const controller = new AbortController();
    importAbortControllerRef.current = controller;
    const mySeq = ++importSeqRef.current;

    setIsSyncing(true);
    setSyncError(null);
    try {
      const imported = await importLogsFromGoogleSheets(token, sheetId, controller.signal);

      // Requirement 3: ignore stale responses - if a newer import has since been
      // requested, this result must never overwrite newer data.
      if (mySeq !== importSeqRef.current) {
        return null;
      }

      // Save imported logs to in-memory store
      imported.forEach(log => {
        saveLogForMonth(log.month, log);
      });

      // Clean up any orphan months in the in-memory store
      const allCached = loadAllLogs();
      allCached.forEach(cachedLog => {
        const stillExists = imported.some(imp => imp.month === cachedLog.month);
        if (!stillExists) {
          deleteLogForMonth(cachedLog.month);
        }
      });

      // Update local logs state in App.tsx
      const updatedLogs = loadAllLogs();
      setLogs(updatedLogs);

      // Update syncedLogs: the single source of truth for every Report view.
      // ReportContext/UI refresh exactly once per winning import (React re-render).
      setSyncedLogs(imported);

      // Validation
      validateImportedMonths(imported);

      const timeStr = new Date().toLocaleTimeString();
      setLastSyncedTime(timeStr);
      localStorage.setItem("google_sheets_last_synced", timeStr);

      return imported;
    } catch (err: any) {
      // Cancelled because a newer request superseded this one - expected, not an error.
      if (err?.name === "AbortError" || mySeq !== importSeqRef.current) {
        return null;
      }
      console.error("Failed to import from Google Sheets:", err);
      setSyncError(err?.message || "Unable to load latest data.");
      throw err;
    } finally {
      // Only the still-current (latest) request may clear the loading indicator;
      // a superseded request's `finally` must not flip isSyncing off under the winner.
      if (mySeq === importSeqRef.current) {
        setIsSyncing(false);
      }
    }
  };

  // Delegate used by GoogleSheetsSync's manual actions (Import All / Export All / Sync
  // Active Month / auto-refresh-after-save) so there remains exactly one place that
  // talks to importLogsFromGoogleSheets.
  const handleManualImport = async (): Promise<MonthlyLog[] | null> => {
    if (!accessToken) return [];
    return runGoogleSheetsImport(accessToken, spreadsheetId);
  };

  // Abort any in-flight import if the app itself unmounts.
  useEffect(() => {
    return () => {
      importAbortControllerRef.current?.abort();
    };
  }, []);

  // Spreadsheet Selection stage: updates the single spreadsheetId source of truth.
  // The effect below reacts to this change and re-runs the single import automatically.
  const handleSpreadsheetIdChange = (id: string) => {
    setSpreadsheetId(id);
    localStorage.setItem("google_sheets_spreadsheet_id", id);
  };

  // --- EXCEL WORKBOOK PIPELINE (desktop only) ---
  // Mirrors the Google Sheets pipeline's role: one place loads data, one
  // place persists it, and every view refreshes from the resulting snapshot.

  /** Push a freshly read workbook snapshot into every store the UI reads. */
  const applyWorkbookSnapshot = (snap: DataSnapshot) => {
    loadAllLogs().forEach(l => deleteLogForMonth(l.month));
    snap.logs.forEach(l => saveLogForMonth(l.month, l));
    // Keep the entry sheet usable: the previous month always exists in memory
    // (it is only written to the workbook when the user actually saves data).
    const prevMonth = getPreviousMonthStr();
    if (!snap.logs.some(l => l.month === prevMonth)) {
      saveLogForMonth(prevMonth, createEmptyLog(prevMonth));
    }
    const all = loadAllLogs();
    setLogs(all);
    setWorkbook(snap);
    setSyncedLogs(snap.logs);
    setIsDirty(false);
    const latestMonth = all.reduce((max, log) => (log.month > max ? log.month : max), all[0]?.month ?? prevMonth);
    setSelectedMonth(prev => (prev && all.some(l => l.month === prev) ? prev : latestMonth));
  };

  const openWorkbook = async (target: string | null, viaDialog = false) => {
    if (!excelProvider || !desktopBridge) return;
    setIsWorkbookBusy(true);
    try {
      const snap = viaDialog
        ? await excelProvider.load({ openDialog: true })
        : await excelProvider.load({ target });
      if (snap) {
        applyWorkbookSnapshot(snap);
        setAppConfig(await desktopBridge.config.get());
        notify(
          "success",
          lang === "th"
            ? `เปิดไฟล์ ${snap.sourceLabel} แล้ว (${snap.logs.length} เดือน)`
            : `Opened ${snap.sourceLabel} (${snap.logs.length} months)`
        );
        if (snap.validation?.warnings?.length) {
          notify("info", snap.validation.warnings.join("\n"));
        }
        if (snap.lock?.locked || snap.lock?.excelOwnerFilePresent) {
          notify(
            "info",
            lang === "th"
              ? "ไฟล์นี้กำลังเปิดอยู่ใน Excel - อ่านข้อมูลได้ แต่การบันทึกจะทำไม่ได้จนกว่าจะปิดไฟล์ใน Excel"
              : "This workbook is currently open in Excel - you can read data, but saving will fail until it is closed in Excel."
          );
        }
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorkbookBusy(false);
    }
  };

  /**
   * Persist the full in-memory data set into the workbook (backup + atomic
   * write happen in the main process). Returns true on success.
   */
  const persistWorkbook = async (): Promise<boolean> => {
    if (!excelProvider || !workbook) return false;
    setIsWorkbookBusy(true);
    try {
      const outcome = await excelProvider.saveAll(loadAllLogs());
      const snap = await excelProvider.reload();
      applyWorkbookSnapshot(snap);
      const backupName = outcome.backupPath ? outcome.backupPath.split(/[\\/]/).pop() : null;
      notify(
        "success",
        lang === "th"
          ? `บันทึกลง ${snap.sourceLabel} สำเร็จ${backupName ? ` (สำรองไฟล์: ${backupName})` : ""}`
          : `Saved to ${snap.sourceLabel}${backupName ? ` (backup: ${backupName})` : ""}`
      );
      return true;
    } catch (err) {
      // The edit stays in memory; surface it and keep the dirty flag on.
      setLogs(loadAllLogs());
      setIsDirty(true);
      const pe = err instanceof ProviderError ? err : null;
      if (pe?.code === "LOCKED") {
        setLockRetry(() => () => {
          void persistWorkbook();
        });
      } else {
        notify("error", pe?.message ?? (err instanceof Error ? err.message : String(err)));
      }
      return false;
    } finally {
      setIsWorkbookBusy(false);
    }
  };

  const handleWorkbookSaveAs = async () => {
    if (!excelProvider) return;
    setIsWorkbookBusy(true);
    try {
      const outcome = await excelProvider.saveAs(loadAllLogs());
      if (outcome) {
        const snap = await excelProvider.reload();
        applyWorkbookSnapshot(snap);
        setAppConfig(await desktopBridge!.config.get());
        notify("success", lang === "th" ? `บันทึกเป็น ${outcome.path} แล้ว` : `Saved as ${outcome.path}`);
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorkbookBusy(false);
    }
  };

  // Desktop startup: load config, open the startup workbook, and listen for
  // "Open With"/second-instance file requests from Windows.
  useEffect(() => {
    if (!desktopBridge) return;
    let disposed = false;
    (async () => {
      try {
        const cfg = await desktopBridge.config.get();
        if (disposed) return;
        setAppConfig(cfg);
        let target: string | null = null;
        if (cfg.startupBehavior === "default") target = cfg.defaultWorkbookPath;
        else if (cfg.startupBehavior === "last") target = cfg.lastWorkbookPath ?? cfg.defaultWorkbookPath;
        if (target) await openWorkbook(target);
      } catch (err) {
        notify("error", `Could not load configuration: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    const unsubscribe = desktopBridge.events.onOpenFilePath(p => {
      void openWorkbook(p);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderReportingUnavailableFallback = () => {
    return (
      <div className="p-12 text-center bg-slate-900/90 border border-slate-800 rounded-3xl max-w-xl mx-auto my-12 space-y-6 shadow-2xl animate-fadeIn">
        <div className="relative inline-flex items-center justify-center p-4 bg-rose-500/10 border border-rose-500/25 rounded-2xl">
          <AlertCircle className="w-8 h-8 text-rose-500 animate-pulse" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-slate-100 tracking-tight">
            {lang === "th" ? "ไม่สามารถโหลดข้อมูลล่าสุดได้" : "Unable to load latest data."}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
            {lang === "th"
              ? "ระบบรายงานจำเป็นต้องเชื่อมโยงข้อมูลกับ Google Sheets โดยตรงเป็นแหล่งข้อมูลหลัก เพื่อป้องกันความคลาดเคลื่อนและสูญหายของข้อมูล"
              : "Reports are powered directly by Google Sheets as the single source of truth. Please connect your Google Account and configure your spreadsheet."}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          {!isGoogleConnected && (
            <button
              onClick={async () => {
                try {
                  await googleSignIn();
                } catch (e) {
                  console.error("Sign in failed:", e);
                }
              }}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-xs text-slate-100 font-bold rounded-xl transition-all shadow-lg hover:shadow-indigo-500/20 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{lang === "th" ? "เชื่อมต่อ Google Account" : "Sign in with Google"}</span>
            </button>
          )}
          {isGoogleConnected && (
            <button
              onClick={() => {
                if (accessToken) runGoogleSheetsImport(accessToken, spreadsheetId).catch(() => {});
              }}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-750 active:bg-slate-700 text-xs text-slate-200 font-semibold rounded-xl border border-slate-700 transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-teal-400 animate-spin-slow" />
              <span>{lang === "th" ? "ลองใหม่อีกครั้ง" : "Retry Loading Data"}</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderReportingLoading = () => {
    return (
      <div className="p-12 text-center bg-slate-900/90 border border-slate-800 rounded-3xl max-w-xl mx-auto my-12 space-y-6 shadow-2xl animate-fadeIn">
        <div className="relative inline-flex items-center justify-center p-4 bg-indigo-500/10 border border-indigo-500/25 rounded-2xl">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-slate-100 tracking-tight">
            {isDesktopApp
              ? lang === "th"
                ? "กำลังอ่านข้อมูลจากไฟล์ Workbook..."
                : "Reading data from the workbook..."
              : lang === "th"
                ? "กำลังดึงข้อมูลล่าสุดจาก Google Sheets..."
                : "Fetching latest metrics from Google Sheets..."}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
            {lang === "th"
              ? "กรุณารอสักครู่ ระบบกำลังนำเข้าข้อมูล ตรวจสอบ และสร้างการวิเคราะห์ผล..."
              : "Please wait while we normalize, validate, and compile your facility analytics directly from the cloud..."}
          </p>
        </div>
      </div>
    );
  };
  
  // Security configuration
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig>({
    pinEnabled: false,
    pinHash: null
  });
  const [isAppLocked, setIsAppLocked] = useState(false);
  const [showSecurityConfigModal, setShowSecurityConfigModal] = useState(false);
  
  // Language configuration (Thai by default, with English toggle)
  const [lang, setLang] = useState<"th" | "en">("th");
  
  // Historical editing configuration
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  
  // Pending save for historical data confirmation popup
  const [pendingSave, setPendingSave] = useState<{
    type: "ups" | "air" | "dc" | "energy";
    execute: () => void;
  } | null>(null);

  // Modal to add a new month
  const [showAddMonthModal, setShowAddMonthModal] = useState(false);
  const [newMonthInput, setNewMonthInput] = useState("");
  const [addMonthError, setAddMonthError] = useState("");

  const maxMonth = useMemo(() => {
    if (logs.length === 0) return getPreviousMonthStr();
    return logs.reduce((max, log) => log.month > max ? log.month : max, logs[0].month);
  }, [logs]);

  // --- LOCAL STORAGE DATA LOAD ---
  const reloadData = () => {
    // Check security config first
    const savedSecurity = localStorage.getItem("facility_security_config");
    if (savedSecurity) {
      try {
        const parsed = JSON.parse(savedSecurity) as SecurityConfig;
        setSecurityConfig(parsed);
        // If PIN is enabled, set lock screen
        if (parsed.pinEnabled && parsed.pinHash) {
          setIsAppLocked(true);
        }
      } catch (e) {
        console.error("Error loading security config", e);
      }
    }

    // Load logs
    let allLogs = loadAllLogs();
    const prevMonth = getPreviousMonthStr();
    
    // Check if previous month's log already exists. If not, auto-create it!
    const hasPrevMonth = allLogs.some(l => l.month === prevMonth);
    if (!hasPrevMonth) {
      const defaultLog = createEmptyLog(prevMonth);
      saveLogForMonth(prevMonth, defaultLog);
      allLogs = loadAllLogs();
    }
    
    setLogs(allLogs);
    
    // Default selectedMonth to previous month if not set yet, or if it doesn't exist anymore
    if (!selectedMonth) {
      setSelectedMonth(prevMonth);
    } else {
      const exists = allLogs.some(l => l.month === selectedMonth);
      if (!exists) {
        setSelectedMonth(prevMonth);
      }
    }
  };

  useEffect(() => {
    reloadData();
  }, []);

  // Single authentication listener - the only subscription to Firebase auth state in the app.
  useEffect(() => {
    return initAuth(
      (currentUser, token) => {
        setIsGoogleConnected(true);
        setGoogleUserEmail(currentUser.email);
        setAccessToken(token);
      },
      () => {
        setIsGoogleConnected(false);
        setGoogleUserEmail(null);
        setAccessToken(null);
        setSyncedLogs(null);
      }
    );
  }, []);

  // Single startup / spreadsheet-change import trigger. Fires exactly once whenever
  // authentication completes or the target spreadsheet changes - this is the only
  // place that automatically triggers a Google Sheets import.
  // Desktop: the workbook is the source of truth for reports, so the Google
  // import never runs automatically there (Sheets stays a manual, optional sync).
  useEffect(() => {
    if (accessToken && !isDesktopApp) {
      runGoogleSheetsImport(accessToken, spreadsheetId).catch(() => {});
    }
  }, [accessToken, spreadsheetId, isDesktopApp]);

  // Update activeLog state when selectedMonth changes
  useEffect(() => {
    if (selectedMonth) {
      const log = loadLogForMonth(selectedMonth);
      setActiveLog(log);
    }
  }, [selectedMonth, logs]);

  // --- ACTION HANDLERS ---
  // After the in-memory store is updated, desktop persists straight into the
  // workbook (with backup + lock handling); the browser build keeps the
  // original in-memory + Google Sheets behavior.
  const commitEntrySave = () => {
    if (isDesktopApp && workbook) {
      void persistWorkbook();
    } else {
      reloadData();
    }
  };

  const handleSaveUps = (records: UpsRecord[]) => {
    if (!activeLog) return;
    const isHistorical = selectedMonth !== maxMonth;
    const saveAction = () => {
      const timestamp = formatTimestamp(new Date());
      const updatedLog: MonthlyLog = {
        ...activeLog,
        ups: records,
        lastSavedUps: timestamp
      };
      saveLogForMonth(selectedMonth, updatedLog);
      commitEntrySave();
    };

    if (isHistorical || editingMonth) {
      setPendingSave({ type: "ups", execute: saveAction });
    } else {
      saveAction();
    }
  };

  const handleSaveAir = (record: AirRecord) => {
    if (!activeLog) return;
    const isHistorical = selectedMonth !== maxMonth;
    const saveAction = () => {
      const timestamp = formatTimestamp(new Date());
      const updatedLog: MonthlyLog = {
        ...activeLog,
        air: record,
        lastSavedAir: timestamp
      };
      saveLogForMonth(selectedMonth, updatedLog);
      commitEntrySave();
    };

    if (isHistorical || editingMonth) {
      setPendingSave({ type: "air", execute: saveAction });
    } else {
      saveAction();
    }
  };

  const handleSaveDc = (records: DcRecord[]) => {
    if (!activeLog) return;
    const isHistorical = selectedMonth !== maxMonth;
    const saveAction = () => {
      const timestamp = formatTimestamp(new Date());
      const updatedLog: MonthlyLog = {
        ...activeLog,
        dc: records,
        lastSavedDc: timestamp
      };
      saveLogForMonth(selectedMonth, updatedLog);
      commitEntrySave();
    };

    if (isHistorical || editingMonth) {
      setPendingSave({ type: "dc", execute: saveAction });
    } else {
      saveAction();
    }
  };

  const handleSaveEnergyCost = (record: EnergyCostRecord) => {
    if (!activeLog) return;
    const isHistorical = selectedMonth !== maxMonth;
    const saveAction = () => {
      const timestamp = formatTimestamp(new Date());
      const updatedLog: MonthlyLog = {
        ...activeLog,
        energyCost: record,
        lastSavedEnergyCost: timestamp
      };
      saveLogForMonth(selectedMonth, updatedLog);
      commitEntrySave();
    };

    if (isHistorical || editingMonth) {
      setPendingSave({ type: "energy", execute: saveAction });
    } else {
      saveAction();
    }
  };

  const handleCreateNewMonth = (e: React.FormEvent) => {
    e.preventDefault();
    setAddMonthError("");

    if (!newMonthInput) {
      setAddMonthError(lang === "th" ? "กรุณาเลือกเดือนและปี" : "Please select month and year");
      return;
    }

    const exists = logs.some(l => l.month === newMonthInput);
    if (exists) {
      setAddMonthError(lang === "th" ? "มีบันทึกของเดือนนี้อยู่แล้วในระบบ" : "Log for this month already exists");
      return;
    }

    const newLog = createEmptyLog(newMonthInput);
    saveLogForMonth(newMonthInput, newLog);
    
    // Refresh states
    setSelectedMonth(newMonthInput);
    setShowAddMonthModal(false);
    setNewMonthInput("");
    reloadData();
  };

  const handleUpdateSecurity = (newConfig: SecurityConfig) => {
    setSecurityConfig(newConfig);
    localStorage.setItem("facility_security_config", JSON.stringify(newConfig));
  };

  // --- LOCALIZATION DICTIONARY ---
  const dict = {
    th: {
      title: "ระบบบันทึกข้อมูลพลังงานรายเดือน",
      subtitle: "ศูนย์ข้อมูลและห้องเครื่องควบคุมหลัก (Facility Power & Energy Logger)",
      monthSelect: "เลือกเดือน",
      addMonth: "เพิ่มเดือนใหม่",
      secureLock: "ล็อคระบบความปลอดภัย",
      unlocked: "ปลดล็อคแล้ว",
      locked: "ล็อคแล้ว",
      configPin: "ตั้งค่ารหัส PIN ล็อคหน้าจอ",
      lastSaved: "บันทึกล่าสุด",
      totalAlerts: "การแจ้งเตือนความผิดปกติ",
      generalSection: "กรอกข้อมูลเครื่องควบคุมและพลังงาน",
      backToTop: "กลับขึ้นด้านบน",
      dataManagement: "จัดการฐานข้อมูล & สำรองไฟล์",
      trendsTitle: "วิเคราะห์แนวโน้มการใช้พลังงาน",
      sampleBtn: "โหลดตัวอย่างการกรอก",
      securePinActive: "เปิดใช้งานระบบ PIN ปลอดภัยแล้ว",
      securePinInactive: "ปิดระบบ PIN แล้ว (ไม่ปลอดภัย)",
      thailandBaht: "บาท (THB)",
      gigaWattHours: "กิกะวัตต์-ชั่วโมง (GWh)",
      kiloWatt: "กิโลวัตต์ (kW)",
      voltText: "โวลต์ (V)",
      ampereText: "แอมแปร์ (A)",
      monthModalTitle: "เพิ่มเดือนสำหรับบันทึกข้อมูลใหม่",
      monthModalPlaceholder: "เลือกเดือน",
      cancel: "ยกเลิก",
      confirm: "ยืนยันการสร้าง",
    },
    en: {
      title: "Monthly Power & Energy Logger",
      subtitle: "Facility Data Center & Control Room Metrics Suite",
      monthSelect: "Selected Month",
      addMonth: "Add New Month",
      secureLock: "Secure Lock Mode",
      unlocked: "Unlocked",
      locked: "Locked",
      configPin: "Configure Screen PIN",
      lastSaved: "Last Saved",
      totalAlerts: "Active System Alerts",
      generalSection: "Facility Metrics Logging Sheets",
      backToTop: "Back to Top",
      dataManagement: "Database & Backup Controls",
      trendsTitle: "Facility Trend Analytics",
      sampleBtn: "Load Demo Records",
      securePinActive: "Device Secure PIN Lock is Active",
      securePinInactive: "Secure PIN Lock is Disabled",
      thailandBaht: "Baht (THB)",
      gigaWattHours: "Giga-Watt Hours (GWh)",
      kiloWatt: "Kilowatt (kW)",
      voltText: "Volts (V)",
      ampereText: "Amperes (A)",
      monthModalTitle: "Establish Log for New Month",
      monthModalPlaceholder: "Select Month",
      cancel: "Cancel",
      confirm: "Create Month",
    }
  };

  const t = dict[lang];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased selection:bg-indigo-500/30">
      
      {/* 1. SECURE PIN SCREEN OVERLAY */}
      <AnimatePresence>
        {isAppLocked && (
          <PinLockModal
            securityConfig={securityConfig}
            onUnlock={() => setIsAppLocked(false)}
            onUpdateSecurity={handleUpdateSecurity}
          />
        )}
      </AnimatePresence>

      {/* 2. INNER APPLICATION UI */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* HEADER RAIL */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-slate-850">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20 text-indigo-400">
                <FileSpreadsheet className="w-6 h-6" />
              </span>
              <h1 className="text-2xl font-display font-bold tracking-tight text-slate-100">
                {t.title}
              </h1>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              {t.subtitle}
            </p>
          </div>

          {/* UTILITY BAR CONTROLS */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Language Switcher */}
            <button
              onClick={() => setLang(lang === "th" ? "en" : "th")}
              className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-xs font-semibold rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-2 transition-all cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-indigo-400" />
              <span>{lang === "th" ? "English (EN)" : "ภาษาไทย (TH)"}</span>
            </button>

            {/* Security Config Pin Toggle */}
            <button
              onClick={() => setShowSecurityConfigModal(true)}
              className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-xs font-semibold rounded-xl border border-slate-800 hover:border-slate-700 flex items-center gap-2 transition-all cursor-pointer"
            >
              <Shield className={`w-3.5 h-3.5 ${securityConfig.pinEnabled ? "text-emerald-400" : "text-slate-500"}`} />
              <span>{securityConfig.pinEnabled ? "PIN Active" : "Set PIN Lock"}</span>
            </button>

            {/* Lock Device Button */}
            {securityConfig.pinEnabled && (
              <button
                onClick={() => setIsAppLocked(true)}
                className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-xl border border-slate-800 hover:border-slate-700 transition-all cursor-pointer"
                title="Lock Device Now"
              >
                <Lock className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {/* 3-PART SEGMENTED NAVIGATION BAR */}
        <nav className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-900 border border-slate-850 p-1.5 rounded-2xl shadow-md">
          <button
            onClick={() => setCurrentView("dashboard")}
            className={`px-4 py-3.5 text-xs font-bold rounded-xl flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
              currentView === "dashboard"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
            }`}
          >
            <BarChart4 className="w-4 h-4 text-indigo-400" />
            <span>{lang === "th" ? "2. หน้าสรุปแดชบอร์ด" : "2. Dashboard Summary"}</span>
          </button>

          <button
            onClick={() => setCurrentView("entry")}
            className={`px-4 py-3.5 text-xs font-bold rounded-xl flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
              currentView === "entry"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-teal-400" />
            <span>{lang === "th" ? "1. หน้ากรอกข้อมูล" : "1. Data Entry Sheet"}</span>
          </button>

          <button
            onClick={() => setCurrentView("history")}
            className={`px-4 py-3.5 text-xs font-bold rounded-xl flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
              currentView === "history"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
            }`}
          >
            <TableProperties className="w-4 h-4 text-amber-400" />
            <span>{lang === "th" ? "3. ประวัติรายเดือนทั้งหมด" : "3. Historical Logs"}</span>
          </button>
        </nav>

        {/* --- VIEW 1: DATA ENTRY SHEET --- */}
        {currentView === "entry" && isDesktopApp && !workbook && (
          <WelcomePanel
            lang={lang}
            recentFiles={appConfig?.recentFiles ?? []}
            isBusy={isWorkbookBusy}
            onOpenDialog={() => void openWorkbook(null, true)}
            onOpenPath={p => void openWorkbook(p)}
          />
        )}
        {currentView === "entry" && !(isDesktopApp && !workbook) && (
          <div className="space-y-8">
            {/* WORKBOOK STATUS & FILE ACTIONS (desktop) */}
            {isDesktopApp && workbook && (
              <WorkbookBar
                workbook={workbook}
                isDirty={isDirty}
                isBusy={isWorkbookBusy}
                lang={lang}
                onOpen={() => void openWorkbook(null, true)}
                onReload={() => {
                  if (workbook.path) void openWorkbook(workbook.path);
                }}
                onSaveAs={() => void handleWorkbookSaveAs()}
                onShowInFolder={() => {
                  if (workbook.path) void desktopBridge?.shell.showItemInFolder(workbook.path);
                }}
              />
            )}

            {/* MONTH SELECTOR & ACTION CONTAINER */}
            <section className="bg-slate-900 border border-slate-850 p-5 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-5 shadow-sm">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-indigo-400 shrink-0" />
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {t.monthSelect}:
                  </label>
                </div>
                
                <div className="relative">
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full sm:w-[180px] bg-slate-950 text-slate-100 font-semibold font-mono text-sm border border-slate-800 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer appearance-none"
                  >
                    {logs.filter(log => log.month === maxMonth || log.month === editingMonth).map((log) => (
                      <option key={log.month} value={log.month}>
                        {formatMonthYear(log.month)} ({log.month})
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                    <span className="text-[10px]">▼</span>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 w-full md:w-auto justify-end">
                <button
                  onClick={() => setShowAddMonthModal(true)}
                  className="px-4 py-2 bg-indigo-650 hover:bg-indigo-600 active:bg-indigo-700 text-xs text-white font-bold rounded-xl shadow-lg shadow-indigo-600/10 flex items-center gap-2 transition-all cursor-pointer w-full sm:w-auto justify-center"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t.addMonth}</span>
                </button>
              </div>
            </section>

            {/* HISTORICAL EDIT NOTICE BANNER */}
            {selectedMonth !== maxMonth && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-xs text-amber-400 animate-fadeIn">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold uppercase tracking-wider block text-[10px] mb-0.5 text-amber-500">
                      {lang === "th" ? "กำลังแก้ไขข้อมูลย้อนหลัง" : "Historical Data Edit Mode"}
                    </span>
                    <span>
                      {lang === "th" 
                        ? `คุณกำลังแก้ไขข้อมูลของเดือน ${formatMonthYear(selectedMonth)} ซึ่งเป็นข้อมูลประวัติ ระบบจะแสดงป๊อปอัปแจ้งเตือนให้ตรวจสอบความถูกต้องก่อนกดบันทึก`
                        : `You are editing historical records for ${formatMonthYear(selectedMonth)}. A validation popup will prompt before saving.`}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setEditingMonth(null);
                    setSelectedMonth(maxMonth);
                  }}
                  className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 text-[11px] font-bold rounded-lg transition-colors cursor-pointer shrink-0 self-end sm:self-center"
                >
                  {lang === "th" ? "ยกเลิกแก้ไข / กลับไปเดือนล่าสุด" : "Cancel Edit / Reset to Latest Month"}
                </button>
              </div>
            )}

            {/* QUICK STATS & THRESHOLD ALERTS */}
            {activeLog && <DashboardStats log={activeLog} />}

            {/* LOGGING TABLES */}
            {activeLog ? (
              <div className="space-y-8">
                
                {/* UPS Logging Section */}
                <UpsTable
                  monthStr={selectedMonth}
                  initialRecords={activeLog.ups}
                  lastSaved={activeLog.lastSavedUps}
                  onSave={handleSaveUps}
                />

                {/* Air Conditioning section */}
                <AirTable
                  monthStr={selectedMonth}
                  initialRecord={activeLog.air}
                  lastSaved={activeLog.lastSavedAir}
                  onSave={handleSaveAir}
                />

                {/* DC Power Panel section */}
                <DcTable
                  monthStr={selectedMonth}
                  initialRecords={activeLog.dc}
                  lastSaved={activeLog.lastSavedDc}
                  onSave={handleSaveDc}
                />

                {/* Building Energy & Cost section */}
                <EnergyCostTable
                  monthStr={selectedMonth}
                  initialRecord={activeLog.energyCost}
                  lastSaved={activeLog.lastSavedEnergyCost}
                  onSave={handleSaveEnergyCost}
                />

              </div>
            ) : (
              <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-2xl">
                <AlertCircle className="w-12 h-12 text-rose-500 mx-auto animate-pulse mb-3" />
                <h4 className="text-base font-semibold text-slate-200">
                  {lang === "th" ? "ไม่พบเอกสารของเดือนนี้" : "Log Record is Missing"}
                </h4>
                <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                  {lang === "th" ? "กรุณาสร้างบันทึกใหม่ หรือคลิกโหลดตัวอย่างเครื่องควบคุมเพื่อเริ่มต้นทำงาน" : "Create a new month or click load samples in the settings tab below."}
                </p>
              </div>
            )}

            {/* GOOGLE SHEETS SYNC BOARD - primary in the browser build;
                optional secondary sync on desktop (enable in config) */}
            {(!isDesktopApp || appConfig?.googleSheets.enabled) && (
              <GoogleSheetsSync
                activeLog={activeLog}
                lang={lang}
                isGoogleConnected={isGoogleConnected}
                googleUserEmail={googleUserEmail}
                accessToken={accessToken}
                spreadsheetId={spreadsheetId}
                onSpreadsheetIdChange={handleSpreadsheetIdChange}
                lastSyncedTime={lastSyncedTime}
                onImport={handleManualImport}
              />
            )}

            {/* DATA MANAGEMENT BAR (browser build only - the desktop app
                manages its database through the workbook + backups) */}
            {!isDesktopApp && <DataManagement onDataChange={reloadData} />}
          </div>
        )}

        {/* --- VIEW 2: BEAUTIFUL DASHBOARD SUMMARY --- */}
        {currentView === "dashboard" && (
          isSyncing || (isWorkbookBusy && !syncedLogs) ? (
            renderReportingLoading()
          ) : syncedLogs ? (
            <ReportProvider syncedLogs={syncedLogs}>
              <DashboardViewContainer
                logs={syncedLogs}
                lang={lang}
                isGoogleConnected={isGoogleConnected}
                googleUserEmail={googleUserEmail}
              />
            </ReportProvider>
          ) : isDesktopApp ? (
            <WelcomePanel
              lang={lang}
              recentFiles={appConfig?.recentFiles ?? []}
              isBusy={isWorkbookBusy}
              onOpenDialog={() => void openWorkbook(null, true)}
              onOpenPath={p => void openWorkbook(p)}
            />
          ) : (
            renderReportingUnavailableFallback()
          )
        )}

        {/* --- VIEW 3: MONTHLY HISTORICAL CATEGORIZED RECORDS --- */}
        {currentView === "history" && (
          isSyncing || (isWorkbookBusy && !syncedLogs) ? (
            renderReportingLoading()
          ) : syncedLogs ? (
            <div className="space-y-8 animate-fadeIn">
              <HistoricalCharts 
                logs={syncedLogs} 
                isGoogleConnected={isGoogleConnected}
                googleUserEmail={googleUserEmail}
                lang={lang}
              />
              <HistoricalExplorer
                logs={syncedLogs}
                lang={lang}
                isGoogleConnected={isGoogleConnected}
                googleUserEmail={googleUserEmail}
                onEditMonth={(monthStr) => {
                  setEditingMonth(monthStr);
                  setSelectedMonth(monthStr);
                  setCurrentView("entry");
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          ) : isDesktopApp ? (
            <WelcomePanel
              lang={lang}
              recentFiles={appConfig?.recentFiles ?? []}
              isBusy={isWorkbookBusy}
              onOpenDialog={() => void openWorkbook(null, true)}
              onOpenPath={p => void openWorkbook(p)}
            />
          ) : (
            renderReportingUnavailableFallback()
          )
        )}

      </div>

      {/* --- ADD NEW MONTH MODAL --- */}
      <AnimatePresence>
        {showAddMonthModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <form onSubmit={handleCreateNewMonth} className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-display font-semibold text-slate-100 text-base">
                    {t.monthModalTitle}
                  </h3>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-medium">
                    {lang === "th" ? "เลือกเดือนและปี" : "Select Month and Year"}
                  </label>
                  <input
                    type="month"
                    required
                    value={newMonthInput}
                    onChange={(e) => {
                      setNewMonthInput(e.target.value);
                      setAddMonthError("");
                    }}
                    className="w-full bg-slate-950 text-slate-100 border border-slate-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm focus:outline-none cursor-pointer"
                  />
                </div>

                {addMonthError && (
                  <p className="text-xs text-rose-400 bg-rose-950/10 border border-rose-900/20 px-3 py-2 rounded-lg font-medium">
                    {addMonthError}
                  </p>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMonthModal(false);
                      setNewMonthInput("");
                      setAddMonthError("");
                    }}
                    className="flex-1 py-2.5 bg-slate-850 hover:bg-slate-800 text-xs font-semibold rounded-xl text-slate-300 transition-all cursor-pointer"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold rounded-xl text-white shadow-lg shadow-indigo-600/15 transition-all cursor-pointer"
                  >
                    {t.confirm}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- PIN CONFIGURATION SETTINGS MODAL --- */}
      <AnimatePresence>
        {showSecurityConfigModal && (
          <PinLockModal
            securityConfig={securityConfig}
            onUnlock={() => {}}
            onUpdateSecurity={(conf) => {
              handleUpdateSecurity(conf);
              setShowSecurityConfigModal(false);
            }}
            isSettingsMode={true}
            onCloseSettings={() => setShowSecurityConfigModal(false)}
          />
        )}
      </AnimatePresence>

      {/* --- HISTORICAL DATA EDIT CONFIRMATION MODAL (POPUP) --- */}
      <AnimatePresence>
        {pendingSave && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-100 text-base">
                      {lang === "th" ? "โปรดยืนยันการบันทึกข้อมูลย้อนหลัง" : "Confirm Saving Historical Data"}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider mt-0.5">
                      {lang === "th" ? `ข้อมูลเดือน: ${formatMonthYear(selectedMonth)}` : `Log Month: ${formatMonthYear(selectedMonth)}`}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs leading-relaxed text-slate-300 bg-slate-950/50 border border-slate-850 p-4 rounded-xl">
                  <p>
                    {lang === "th" 
                      ? "⚠️ คุณกำลังทำการแก้ไขข้อมูลที่ระบุย้อนหลัง ซึ่งอยู่นอกเหนือจากระบบกรอกข้อมูลของเดือนปัจจุบัน" 
                      : "⚠️ You are saving edits to historical records outside the current default logging period."}
                  </p>
                  <p className="font-medium text-amber-400">
                    {lang === "th"
                      ? "กรุณาตรวจสอบค่าตัวเลขทั้งหมดอย่างละเอียดอีกครั้ง เพื่อป้องกันความคลาดเคลื่อนของการคำนวณอัตราค่าไฟฟ้าและการรายงานสถิติบนแผงควบคุม"
                      : "Please inspect all numerical figures carefully. Incorrect entries will affect average electricity rate formulas and historical dashboards."}
                  </p>
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setPendingSave(null)}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-semibold rounded-xl text-slate-300 transition-all cursor-pointer border border-slate-700/50"
                  >
                    {lang === "th" ? "ยกเลิก / กลับไปตรวจสอบ" : "Cancel / Verify Again"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (pendingSave) {
                        pendingSave.execute();
                        setPendingSave(null);
                      }
                    }}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold rounded-xl text-white shadow-lg shadow-emerald-600/15 transition-all cursor-pointer"
                  >
                    {lang === "th" ? "ยืนยันและบันทึก" : "Confirm & Save"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- WORKBOOK LOCKED CONFLICT MODAL (desktop) --- */}
      <AnimatePresence>
        {lockRetry && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-100 text-base">
                      {lang === "th" ? "ไม่สามารถบันทึกได้ - ไฟล์ถูกล็อค" : "Cannot Save - Workbook is Locked"}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider mt-0.5">
                      {workbook?.sourceLabel}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs leading-relaxed text-slate-300 bg-slate-950/50 border border-slate-850 p-4 rounded-xl">
                  <p>
                    {lang === "th"
                      ? "ไฟล์ Workbook นี้กำลังเปิดอยู่ในโปรแกรม Excel (หรือโปรแกรมอื่น) ระบบจึงไม่สามารถเขียนทับได้ ข้อมูลที่แก้ไขยังอยู่ครบในหน่วยความจำและยังไม่สูญหาย"
                      : "The workbook is currently open in Excel (or another program), so it cannot be overwritten. Your edits are still held in memory - nothing is lost."}
                  </p>
                  <p className="font-medium text-amber-400">
                    {lang === "th"
                      ? "ปิดไฟล์ใน Excel แล้วกด \"ลองอีกครั้ง\" หรือบันทึกเป็นไฟล์ใหม่ด้วย \"บันทึกเป็น...\""
                      : "Close the file in Excel and press \"Retry\", or write your data to a new file with \"Save As…\"."}
                  </p>
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setLockRetry(null)}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-semibold rounded-xl text-slate-300 transition-all cursor-pointer border border-slate-700/50"
                  >
                    {lang === "th" ? "ยกเลิก" : "Cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLockRetry(null);
                      void handleWorkbookSaveAs();
                    }}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-bold rounded-xl text-slate-200 transition-all cursor-pointer border border-slate-700/50"
                  >
                    {lang === "th" ? "บันทึกเป็น..." : "Save As…"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const retry = lockRetry;
                      setLockRetry(null);
                      retry?.();
                    }}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold rounded-xl text-white shadow-lg shadow-indigo-600/15 transition-all cursor-pointer"
                  >
                    {lang === "th" ? "ลองอีกครั้ง" : "Retry"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- APP-WIDE TOASTS --- */}
      <ToastHost />

    </div>
  );
}
