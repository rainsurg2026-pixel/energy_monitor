import React, { useState, useEffect, useMemo, useRef } from "react";
import { googleSignIn } from "./firebaseAuth";
import { createGoogleSheetsDriver, GoogleSheetsDriver, GoogleConnectionState } from "./googleSheetsDriver";
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
import { DEFAULT_SPREADSHEET_ID } from "./sheetsService";
import { MonthlyLog, SecurityConfig, UpsRecord, AirRecord, DcRecord, EnergyCostRecord, SrinakarinInputSnapshot } from "./types";
import { DataSnapshot, ProviderError } from "./data/IDataProvider";
import { ExcelProvider } from "./data/ExcelProvider";
import { getDesktopBridge } from "./data/ProviderFactory";
import type { AppConfig, DeviceLists, ExportProgress, FacilityEntry, WorkbookAccessStatus } from "./desktop";
import type { DashboardUpsMappingReport, RackCapacitySummary } from "./reports/reportTypes";
import StatusBar from "./components/StatusBar";
import SaveProgress, { SaveProgressState } from "./components/SaveProgress";
import FacilitySelector from "./components/FacilitySelector";
import EntryWorkflowHeader from "./components/EntryWorkflowHeader";
import StickyEntryToolbar from "./components/StickyEntryToolbar";
import ExportCenterModal, { ExportKind } from "./components/ExportCenterModal";
import { buildCombinedCsv, buildIntegrityText, buildSectionCsvs } from "./utils/exportData";
import { EntrySectionApi, MissingField, computeCompletion, listMissingFields } from "./utils/completion";
import { beginSaveOnce, clearEntryUndoHistory, endSaveOnce } from "./utils/entrySession";
import ToastHost, { notify } from "./components/Toast";
import WorkbookBar from "./components/WorkbookBar";
import WelcomePanel from "./components/WelcomePanel";
import SettingsPanel from "./components/SettingsPanel";
import IntegrityCenter from "./components/IntegrityCenter";
import type { RecoverySnapshot } from "./desktop";
import DashboardStats from "./components/DashboardStats";
import UpsTable from "./components/UpsTable";
import SrinakarinPowerPhaseTable from "./components/SrinakarinPowerPhaseTable";
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
import FacilityComparison from "./components/FacilityComparison";
import RackCapacityEditor from "./components/RackCapacityEditor";
import RackCapacitySummaryCard from "./components/RackCapacitySummaryCard";
import RackCapacityHistoryPanel from "./components/RackCapacityHistoryPanel";
import RackUnitCapacityPanel from "./components/RackUnitCapacityPanel";
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
  RefreshCw,
  Server
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

function DashboardViewContainer({
  logs,
  lang,
  isGoogleConnected,
  googleUserEmail,
  rackCapacity,
  upsMapping,
  facility,
  onExport
}: {
  logs: MonthlyLog[];
  lang: "th" | "en";
  isGoogleConnected: boolean;
  googleUserEmail: string | null;
  rackCapacity?: RackCapacitySummary | null;
  upsMapping?: DashboardUpsMappingReport | null;
  facility: FacilityEntry | null;
  onExport?: (format: "pdf" | "excel" | "csv" | "png") => void;
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
    if (onExport) {
      onExport(format);
    } else {
      notify(
        "info",
        lang === "th"
          ? `การส่งออก ${format.toUpperCase()} ใช้ได้ในเวอร์ชันเดสก์ท็อป`
          : `${format.toUpperCase()} export is available in the desktop app.`
      );
    }
  };

  return (
    <div className="space-y-6">
      <UniversalFilterBar lang={lang} onExport={handleExport} facility={facility} />

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
            rackCapacity={rackCapacity}
            upsMapping={upsMapping}
            facility={facility}
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
  // Language configuration (Thai by default, with English toggle)
  const [lang, setLang] = useState<"th" | "en">("th");
  const [logs, setLogs] = useState<MonthlyLog[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [activeLog, setActiveLog] = useState<MonthlyLog | null>(null);
  const [currentView, setCurrentView] = useState<"dashboard" | "entry" | "rackCapacity" | "history" | "comparison" | "settings">("dashboard");
  // Shared Month/Year selector for the Rack Capacity page's Rack Unit
  // Capacity panel and Rack Capacity Editor (which History snapshot a field
  // edit's save upserts) - an explicit, user-visible choice, never a silent
  // system-month assumption. Defaults to today's month; independent of Data
  // Entry's own selectedMonth (that has separate historical-edit semantics).
  const [rackCapacityMonth, setRackCapacityMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));

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
  const [lastPersistAt, setLastPersistAt] = useState<string | null>(null);
  const [recoveryOffer, setRecoveryOffer] = useState<RecoverySnapshot | null>(null);

  // --- RC2: DATA ENTRY WORKFLOW ---
  // Continuous workbook access monitoring (read-only mode + health), status
  // bar data and unsaved-changes navigation protection.
  const [access, setAccess] = useState<WorkbookAccessStatus | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [unavailableDialogOpen, setUnavailableDialogOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  /** A facility/year/month switch requested while edits are pending waits here for Save / Discard / Cancel. */
  const [pendingNav, setPendingNav] = useState<{ run: () => void } | null>(null);

  // --- RC3: DATA ENTRY EXPERIENCE ---
  /** Staged save progress card (Validating → Backup → Write → Verify → Refresh → Done). */
  const [saveProgress, setSaveProgress] = useState<SaveProgressState | null>(null);

  // Internal performance monitor: measured, logged, never blocking.
  const PERF_TARGETS = {
    openWorkbookMs: 2000,
    switchMonthMs: 500,
    saveMs: 3000,
    dashboardRefreshMs: 1000
  } as const;
  type PerfKey = keyof typeof PERF_TARGETS;
  const recordPerf = (key: PerfKey, ms: number) => {
    const host = window as unknown as { __emPerf?: Partial<Record<PerfKey, number>> };
    (host.__emPerf ??= {})[key] = Math.round(ms);
    if (ms > PERF_TARGETS[key]) {
      console.warn(`[PERF] ${key}: ${Math.round(ms)}ms exceeded the ${PERF_TARGETS[key]}ms target`);
    }
  };
  /** Duration until React has committed and the event loop turned twice.
   *  (Not rAF: animation frames are throttled in unfocused windows.) */
  const recordPerfAfterPaint = (key: PerfKey, t0: number) => {
    setTimeout(() => setTimeout(() => recordPerf(key, performance.now() - t0), 0), 0);
  };

  // --- MULTI-FACILITY (RC1) ---
  // Each facility has its own independent workbook + profile; the active
  // profile drives device lists, labels and thresholds everywhere.
  const [facilities, setFacilities] = useState<FacilityEntry[]>([]);
  const [activeFacilityId, setActiveFacilityId] = useState<string | null>(null);
  const activeFacility = useMemo(
    () => facilities.find(f => f.id === activeFacilityId) ?? null,
    [facilities, activeFacilityId]
  );
  // Ref mirror so one-time effects/closures always see the current lists.
  const deviceListsRef = useRef<DeviceLists | null>(null);
  useEffect(() => {
    deviceListsRef.current = activeFacility
      ? { upsIds: activeFacility.profile.devices.ups, dcIds: activeFacility.profile.devices.dc, airFields: activeFacility.profile.air.fields }
      : null;
    excelProvider?.setDeviceLists(deviceListsRef.current ?? undefined);
    // UPS Group History persistence reads its topology dynamically from
    // facility.profile.dashboard.upsGroups - never hardcoded here.
    excelProvider?.setUpsGroupContext(
      activeFacility && activeFacility.profile.dashboard.upsGroups.length > 0
        ? { facilityId: activeFacility.id, upsGroups: activeFacility.profile.dashboard.upsGroups }
        : undefined
    );
  }, [activeFacility, excelProvider]);

  /** createEmptyLog honoring the active facility's device profile. */
  const emptyLogForMonth = (month: string) =>
    createEmptyLog(month, deviceListsRef.current?.upsIds, deviceListsRef.current?.dcIds);
  // Live mirrors for timers (auto-save) so intervals never see stale state.
  const isDirtyRef = useRef(false);
  const isBusyRef = useRef(false);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);
  useEffect(() => {
    isBusyRef.current = isWorkbookBusy;
  }, [isWorkbookBusy]);
  
  // Google Sheets state shared globally. The driver abstracts over WHICH
  // backend actually owns OAuth (desktop: Electron main process via IPC,
  // never a token in this renderer; browser: the pre-existing Firebase
  // client-side flow) - see googleSheetsDriver.ts's header comment.
  const googleDriverRef = useRef<GoogleSheetsDriver | null>(null);
  if (!googleDriverRef.current) googleDriverRef.current = createGoogleSheetsDriver(isDesktopApp);
  const googleDriver = googleDriverRef.current;
  const [googleConnectionState, setGoogleConnectionState] = useState<GoogleConnectionState>(() => googleDriver.getState());
  const isGoogleConnected = googleConnectionState.status === "connected";
  const googleUserEmail = googleConnectionState.email;

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

  // Concurrency guards for the Google Sheets import pipeline: only the most recently
  // requested import may run its network calls and commit state. Every earlier
  // in-flight import is aborted and its (possibly still-arriving) result is ignored.
  const importAbortControllerRef = useRef<AbortController | null>(null);
  const importSeqRef = useRef(0);

  /**
   * The single, authoritative Google Sheets import pipeline for the whole app:
   * Cancel-previous -> Single Import -> Validation -> Update syncedLogs (which
   * reactively refreshes ReportContext and every Report view via props). This
   * is the ONLY function that calls the driver's importAll(), and it backs
   * every trigger (spreadsheet change, manual import, retry, auto-refresh-after-save).
   *
   * Returns the imported logs, or null if this call was superseded by a newer
   * request before it could complete (cancelled - not an error). The desktop
   * driver's underlying IPC call cannot itself be aborted mid-flight (unlike
   * the browser driver's fetch, which honors the AbortController below) - the
   * sequence-number check still guarantees a superseded response is never
   * applied, just without saving the wasted main-process work.
   */
  const runGoogleSheetsImport = async (sheetId: string): Promise<MonthlyLog[] | null> => {
    // Requirement 1 & 2: only one import runs at a time; a new request cancels the previous one.
    importAbortControllerRef.current?.abort();
    const controller = new AbortController();
    importAbortControllerRef.current = controller;
    const mySeq = ++importSeqRef.current;

    setIsSyncing(true);
    setSyncError(null);
    try {
      const imported = await googleDriver.importAll(sheetId);

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

      const timeStr = formatTimestamp(new Date());
      setLastSyncedTime(timeStr);
      if (!isDesktopApp) localStorage.setItem("google_sheets_last_synced", timeStr);

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
  // talks to the Google Sheets driver's importAll().
  const handleManualImport = async (): Promise<MonthlyLog[] | null> => {
    if (googleConnectionState.status !== "connected") return [];
    return runGoogleSheetsImport(spreadsheetId);
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
    if (isDesktopApp && desktopBridge) {
      void desktopBridge.config
        .update({ googleSheets: { enabled: appConfig?.googleSheets.enabled ?? false, spreadsheetId: id } })
        .then(setAppConfig)
        .catch(() => undefined);
    } else {
      localStorage.setItem("google_sheets_spreadsheet_id", id);
    }
  };

  // --- EXCEL WORKBOOK PIPELINE (desktop only) ---
  // Mirrors the Google Sheets pipeline's role: one place loads data, one
  // place persists it, and every view refreshes from the resulting snapshot.

  const selectMonthContext = (next: React.SetStateAction<string>) => {
    clearEntryUndoHistory(undoStackRef);
    setSelectedMonth(next);
  };

  /** Push a freshly read workbook snapshot into every store the UI reads. */
  const applyWorkbookSnapshot = (snap: DataSnapshot) => {
    const tRefresh = performance.now();
    recordPerfAfterPaint("dashboardRefreshMs", tRefresh);
    // The entry form's <input> DOM nodes are not remounted on data changes
    // (they're keyed by stable device IDs, not by month/facility/workbook),
    // so any undo entry recorded before this snapshot targets a node that
    // may now display a different record. Never let Ctrl+Z reach across a
    // workbook swap (facility switch, reload, save, save-as, restore).
    loadAllLogs().forEach(l => deleteLogForMonth(l.month));
    snap.logs.forEach(l => saveLogForMonth(l.month, l));
    // Keep the entry sheet usable: the previous month always exists in memory
    // (it is only written to the workbook when the user actually saves data).
    const prevMonth = getPreviousMonthStr();
    if (!snap.logs.some(l => l.month === prevMonth)) {
      saveLogForMonth(prevMonth, emptyLogForMonth(prevMonth));
    }
    const all = loadAllLogs();
    setLogs(all);
    setWorkbook(snap);
    setSyncedLogs(snap.logs);
    setIsDirty(false);
    setLastLoadedAt(formatTimestamp(new Date()));
    const latestMonth = all.reduce((max, log) => (log.month > max ? log.month : max), all[0]?.month ?? prevMonth);
    selectMonthContext(prev => (prev && all.some(l => l.month === prev) ? prev : latestMonth));
  };

  const openWorkbook = async (target: string | null, viaDialog = false) => {
    if (!excelProvider || !desktopBridge) return;
    setIsWorkbookBusy(true);
    const tOpen = performance.now();
    try {
      const snap = viaDialog
        ? await excelProvider.load({ openDialog: true })
        : await excelProvider.load({ target });
      if (snap) {
        recordPerf("openWorkbookMs", performance.now() - tOpen);
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
        if (snap.upsMappingError) {
          notify(
            "error",
            lang === "th"
              ? `อ่านข้อมูล UPS Mapping ไม่สำเร็จ: ${snap.upsMappingError}`
              : `Could not read UPS mapping data: ${snap.upsMappingError}`
          );
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
   * `silent` (auto-save): failures become toasts instead of the lock modal.
   */
  const persistWorkbook = async (silent = false): Promise<boolean> => {
    if (!excelProvider || !workbook) return false;
    // Re-entrancy guard: a second save (double Ctrl+S, double-click on the
    // historical-save confirm button, or auto-save firing mid-save) must
    // never reach the main process while one is already in flight - two
    // concurrent excel:save IPC calls race on the same file on disk (proven:
    // logs/app.log showed WRITE_FAILED/EBUSY immediately followed by a
    // successful save from the other concurrent call, milliseconds apart).
    // isBusyRef is set synchronously here (not left to the isWorkbookBusy
    // effect below, which only flushes on the next render) so that two
    // calls fired within the same synchronous event-handler tick cannot
    // both pass this check before either has committed state.
    if (!beginSaveOnce(isBusyRef)) return false;
    // RC2 read-only mode: never attempt a write while the workbook is not
    // safely writable (locked, read-only permission, unavailable, ...).
    if (readOnlyRef.current) {
      endSaveOnce(isBusyRef);
      notify(
        silent ? "info" : "error",
        (lang === "th" ? "บันทึกไม่ได้ - โหมดอ่านอย่างเดียว" : "Cannot save - read-only mode.") +
          (readOnlyReason ? `\n${readOnlyReason}` : "")
      );
      return false;
    }
    setIsWorkbookBusy(true);
    // RC3: staged save progress. Lock + backup + write + verify happen inside
    // one atomic IPC call, so those stages resolve together when that call
    // succeeds; backend failures report the exact failed stage.
    const tSave = performance.now();
    const stage = (current: SaveProgressState["current"]) => {
      if (!silent) setSaveProgress(prev => ({ startedAt: prev?.startedAt ?? tSave, current }));
    };
    stage("validate");
    try {
      stage("lock");
      const outcome = await excelProvider.saveAll(loadAllLogs(), editingMonth ?? selectedMonth ?? undefined);
      stage("refresh");
      const snap = await excelProvider.reload();
      applyWorkbookSnapshot(snap);
      // A committed save supersedes any crash-recovery journal.
      void desktopBridge?.recovery.clear();
      setLastPersistAt(formatTimestamp(new Date()));
      void refreshAccess(); // new mtime/backup -> keep status bar current
      const saveMs = performance.now() - tSave;
      recordPerf("saveMs", saveMs);
      if (!silent) setSaveProgress({ startedAt: tSave, current: "done", elapsedMs: saveMs });
      const backupName = outcome.backupPath ? outcome.backupPath.split(/[\\/]/).pop() : null;
      notify(
        "success",
        lang === "th"
          ? `บันทึกลง ${snap.sourceLabel} สำเร็จ${backupName ? ` (สำรองไฟล์: ${backupName})` : ""}`
          : `Saved to ${snap.sourceLabel}${backupName ? ` (backup: ${backupName})` : ""}`
      );
      return true;
    } catch (err) {
      const pe = err instanceof ProviderError ? err : null;
      if (!silent) {
        // Report the ACTUAL failed step from the backend when available,
        // rather than guessing from the last stage optimistically marked
        // "in progress" client-side (proven wrong: a lock failure at the
        // pre-backup check was previously shown with "Creating Backup"
        // checked off, though zero backup was ever written - see
        // WorkbookWriter.ts's SaveFailureStage).
        const backendStageMap: Record<string, SaveProgressState["current"]> = {
          read: "validate",
          validate: "validate",
          lock: "lock",
          backup: "backup",
          write: "write"
        };
        setSaveProgress(prev => ({
          startedAt: prev?.startedAt ?? tSave,
          current: prev?.current ?? "write",
          failedAt: (pe?.stage && backendStageMap[pe.stage]) ?? (prev?.current === "refresh" ? "refresh" : "write"),
          error: err instanceof Error ? err.message : String(err),
          elapsedMs: performance.now() - tSave
        }));
      }
      // The edit stays in memory; surface it, keep the dirty flag on, and
      // journal the unsaved state so a crash cannot lose it.
      setLogs(loadAllLogs());
      setIsDirty(true);
      if (desktopBridge && workbook.path) {
        void desktopBridge.recovery.set({ workbookPath: workbook.path, logs: loadAllLogs() });
      }
      if (pe?.code === "LOCKED" && !silent) {
        setLockRetry(() => () => {
          void persistWorkbook();
        });
      } else {
        notify(
          silent && pe?.code === "LOCKED" ? "info" : "error",
          silent && pe?.code === "LOCKED"
            ? lang === "th"
              ? "บันทึกอัตโนมัติถูกข้าม - ไฟล์เปิดอยู่ใน Excel (ข้อมูลยังอยู่ครบ จะลองใหม่รอบถัดไป)"
              : "Auto-save skipped - the workbook is open in Excel (your data is safe; will retry next cycle)."
            : pe?.message ?? (err instanceof Error ? err.message : String(err))
        );
      }
      return false;
    } finally {
      endSaveOnce(isBusyRef);
      setIsWorkbookBusy(false);
    }
  };

  /** Restore a timestamped backup over the current workbook (Settings page). */
  const handleRestoreBackup = async (backupPath: string) => {
    if (!desktopBridge || !workbook?.path) return;
    setIsWorkbookBusy(true);
    try {
      const result = await desktopBridge.backups.restore({ workbookPath: workbook.path, backupPath });
      if (!result.ok) {
        const failure = result as { code: string; message: string };
        notify("error", failure.message);
        return;
      }
      const payload = result as { ok: true } & import("./desktop").OpenWorkbookPayload & { safetyBackupPath: string };
      applyWorkbookSnapshot({
        logs: payload.logs,
        sourceLabel: payload.path.split(/[\\/]/).pop() ?? payload.path,
        path: payload.path,
        health: payload.health,
        integrity: payload.integrity,
        validation: payload.validation,
        lock: payload.lock
      });
      notify(
        "success",
        lang === "th"
          ? `กู้คืนจากไฟล์สำรองแล้ว (ไฟล์เดิมถูกสำรองไว้ที่ ${payload.safetyBackupPath.split(/[\\/]/).pop()})`
          : `Backup restored (previous file kept as ${payload.safetyBackupPath.split(/[\\/]/).pop()})`
      );
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorkbookBusy(false);
    }
  };

  // Auto Save: on the configured interval, flush unsaved changes silently.
  useEffect(() => {
    const minutes = appConfig?.autoSaveIntervalMinutes ?? 0;
    if (!isDesktopApp || !workbook?.path || minutes <= 0) return;
    const id = setInterval(() => {
      // Read-only mode (RC2) suspends Auto Save entirely.
      if (isDirtyRef.current && !isBusyRef.current && !readOnlyRef.current) {
        void persistWorkbook(true);
      }
    }, minutes * 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktopApp, workbook?.path, appConfig?.autoSaveIntervalMinutes]);

  // Crash recovery: once a workbook is open, offer any journaled unsaved
  // changes that belong to it (written when a save failed / before a crash).
  useEffect(() => {
    if (!desktopBridge || !workbook?.path) return;
    let disposed = false;
    void desktopBridge.recovery.get().then(result => {
      if (disposed || !result.ok) return;
      const snapshot = (result as { ok: true; snapshot: RecoverySnapshot | null }).snapshot;
      if (snapshot && snapshot.workbookPath === workbook.path && snapshot.logs.length > 0) {
        setRecoveryOffer(snapshot);
      }
    });
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook?.path]);

  // --- RC2: CONTINUOUS ACCESS / HEALTH MONITOR + READ-ONLY MODE ---
  // Re-checks the open workbook (exists / readable / writable / locked /
  // read-only / backup status) on open, after every save and on an interval,
  // so the app flips in and out of read-only mode automatically.

  const accessFailStreakRef = useRef(0);
  const readOnlyRef = useRef(false);

  const refreshAccess = async (): Promise<WorkbookAccessStatus | null> => {
    if (!desktopBridge || !workbook?.path) return null;
    try {
      const result = await desktopBridge.excel.access(workbook.path);
      if (!result.ok) return null;
      const status = result as { ok: true } & WorkbookAccessStatus;
      setAccess(status);
      return status;
    } catch {
      return null;
    }
  };

  /**
   * RC2 auto-recovery: re-check an unavailable workbook and bring it back
   * without a restart. In-memory edits always win over the file on disk.
   */
  const attemptRecovery = async (): Promise<boolean> => {
    if (!excelProvider) return false;
    const status = await refreshAccess();
    if (!status?.exists || !status.readable) return false;
    accessFailStreakRef.current = 0;
    setUnavailableDialogOpen(false);
    if (isDirtyRef.current) {
      notify(
        "info",
        lang === "th"
          ? "ไฟล์ Workbook กลับมาใช้งานได้แล้ว - ข้อมูลที่แก้ไขไว้ยังอยู่ครบ กดบันทึกเพื่อเขียนลงไฟล์"
          : "The workbook is available again - your unsaved edits are intact; save to write them to the file."
      );
      return true;
    }
    try {
      applyWorkbookSnapshot(await excelProvider.reload());
      notify(
        "success",
        lang === "th" ? "ไฟล์ Workbook กลับมาใช้งานได้แล้ว - โหลดข้อมูลใหม่เรียบร้อย" : "The workbook is available again - data reloaded."
      );
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!isDesktopApp || !workbook?.path) {
      setAccess(null);
      return;
    }
    let disposed = false;
    accessFailStreakRef.current = 0;

    const tick = async () => {
      const status = await refreshAccess();
      if (disposed || !status) return;
      if (status.exists && status.readable) {
        if (accessFailStreakRef.current > 0) await attemptRecovery();
        return;
      }
      accessFailStreakRef.current += 1;
      if (accessFailStreakRef.current > 1) return; // recovery dialog already offered
      // Automatic recovery: a few quick retries before surfacing the dialog
      // (covers transient share drops / files mid-move). Never crashes.
      for (let attempt = 0; attempt < 3 && !disposed; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (await attemptRecovery()) return;
      }
      if (!disposed) setUnavailableDialogOpen(true);
    };

    void tick();
    const id = setInterval(() => void tick(), 15_000);
    return () => {
      disposed = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktopApp, workbook?.path]);

  /** RC2 read-only mode: on when the open workbook cannot be safely written. */
  const readOnly = isDesktopApp && !!workbook && !!access && !access.writable;
  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  const readOnlyReason = useMemo(() => {
    if (!access || access.writable) return null;
    const th = lang === "th";
    switch (access.reason) {
      case "NOT_FOUND":
        return th
          ? "ไม่พบไฟล์ Workbook (ถูกย้าย ถูกลบ หรือไดรฟ์/เครือข่ายไม่พร้อมใช้งาน)"
          : "Workbook is unavailable (moved, deleted, or the drive/network share is unreachable).";
      case "NO_READ":
        return th ? "คุณไม่มีสิทธิ์อ่านไฟล์ Workbook นี้" : "You do not have permission to read this workbook.";
      case "LOCKED_EXCEL":
        return th ? "ไฟล์ถูกล็อคโดยผู้ใช้อื่น (เปิดอยู่ใน Excel)" : "Workbook is locked by another user (open in Excel).";
      case "LOCKED":
        return th ? "ไฟล์ถูกล็อคโดยโปรแกรมอื่น" : "Workbook is locked by another program.";
      case "READONLY_FILE":
        return th ? "คุณมีสิทธิ์อ่านอย่างเดียว (ไฟล์ถูกตั้งค่า Read-Only)" : "You only have read permission (the file is marked read-only).";
      default:
        return th ? "ไม่สามารถเขียนไฟล์ Workbook ได้" : "The workbook cannot be written.";
    }
  }, [access, lang]);

  const notifyReadOnly = () =>
    notify(
      "error",
      (lang === "th" ? "แก้ไขไม่ได้ - โหมดอ่านอย่างเดียว" : "Editing is disabled - read-only mode.") +
        (readOnlyReason ? `\n${readOnlyReason}` : "")
    );

  // Status-bar signals: overall workbook health score + integrity issue count.
  const healthPercent = useMemo(() => {
    if (!isDesktopApp || !workbook) return null;
    const h = workbook.health;
    const checks = [
      access ? access.exists : true,
      access ? access.readable : true,
      access ? access.writable : true,
      h ? h.structureOk : true,
      h ? h.duplicateCount === 0 : true,
      h ? h.invalidIdCount === 0 : true,
      h ? h.blankRowCount === 0 : true,
      access ? access.lastBackupAt !== null : true
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [isDesktopApp, workbook, access]);

  const integrityIssues = useMemo(() => {
    const i = workbook?.integrity;
    if (!i) return null;
    return (
      i.duplicateKeys.length + i.missingMonths.length + i.missingDevices.length + i.unexpectedBlankRows.length + i.invalidIds.length
    );
  }, [workbook?.integrity]);

  // Offline indicator (the app is fully offline-capable; this is informational).
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!desktopBridge) return;
    desktopBridge.app
      .getInfo()
      .then(info => setAppVersion(info.version))
      .catch(() => undefined);
  }, [desktopBridge]);

  // RC3: the save-progress card dismisses itself shortly after a clean save;
  // failures stay on screen until dismissed.
  useEffect(() => {
    if (saveProgress?.current === "done" && !saveProgress.failedAt) {
      const id = setTimeout(() => setSaveProgress(null), 3000);
      return () => clearTimeout(id);
    }
  }, [saveProgress]);

  // --- RC3: SESSION UNDO (Ctrl+Z) ---
  // One undo entry per field edit (keystrokes within a focus session
  // coalesce), covering text/number inputs, dropdowns and checkboxes inside
  // the entry sections. Session-only - no workbook rollback. Restoring a
  // value re-dispatches input/change, so drafts and the dirty state stay
  // exactly consistent.
  interface UndoEntry {
    el: HTMLInputElement | HTMLSelectElement;
    kind: "input" | "select" | "checkbox";
    value: string;
    checked?: boolean;
  }
  const undoStackRef = useRef<UndoEntry[]>([]);
  const undoBaselineRef = useRef<WeakMap<Element, string>>(new WeakMap());
  const undoSessionElRef = useRef<Element | null>(null);
  const suppressUndoRecordRef = useRef(false);

  useEffect(() => {
    const inEntry = (el: Element | null): boolean => !!el && !!(el as HTMLElement).closest?.("[id^='entry-section-']");
    const currentValueOf = (t: HTMLInputElement | HTMLSelectElement): string =>
      (t as HTMLInputElement).type === "checkbox" ? String((t as HTMLInputElement).checked) : t.value;

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (!inEntry(t as Element) || !("value" in t)) return;
      undoBaselineRef.current.set(t, currentValueOf(t));
      undoSessionElRef.current = null;
    };

    const onInput = (e: Event) => {
      if (suppressUndoRecordRef.current) return;
      const t = e.target as HTMLInputElement | HTMLSelectElement;
      if (!inEntry(t as Element) || !("value" in t)) return;
      const kind: UndoEntry["kind"] =
        (t as HTMLInputElement).type === "checkbox" ? "checkbox" : t.tagName === "SELECT" ? "select" : "input";
      if (kind === "input" && undoSessionElRef.current === t) return; // coalesce keystrokes
      const baseline = undoBaselineRef.current.get(t) ?? "";
      undoStackRef.current.push({
        el: t,
        kind,
        value: kind === "checkbox" ? "" : baseline,
        checked: kind === "checkbox" ? baseline === "true" : undefined
      });
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
      if (kind === "input") {
        undoSessionElRef.current = t;
      } else {
        undoBaselineRef.current.set(t, currentValueOf(t)); // next change of the same control undoes to this
      }
    };

    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("input", onInput, true);
    return () => {
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("input", onInput, true);
    };
  }, []);

  /** Undo the most recent field edit still present on screen. */
  const undoLastEdit = (): boolean => {
    const stack = undoStackRef.current;
    while (stack.length > 0) {
      const entry = stack.pop()!;
      const el = entry.el;
      if (!el.isConnected) continue; // month/facility switched - stale target
      suppressUndoRecordRef.current = true;
      try {
        if (entry.kind === "checkbox") {
          if ((el as HTMLInputElement).checked !== entry.checked) (el as HTMLInputElement).click();
        } else {
          const proto = entry.kind === "select" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
          setter.call(el, entry.value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } finally {
        suppressUndoRecordRef.current = false;
      }
      undoBaselineRef.current.set(el, entry.kind === "checkbox" ? String(entry.checked) : entry.value);
      undoSessionElRef.current = null;
      (el as HTMLElement).scrollIntoView?.({ block: "center", behavior: "smooth" });
      (el as HTMLElement).focus?.({ preventScroll: true });
      return true;
    }
    return false;
  };

  // Keyboard shortcuts (RC3/RC6): Ctrl+S save-all (entry), Ctrl+E and
  // Ctrl+Shift+S export center, Ctrl+Z undo last edit, F5 refresh workbook,
  // Enter / Shift+Enter move between entry fields. Tab stays native.
  const currentViewRef = useRef(currentView);
  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);
  const handleToolbarSaveRef = useRef<() => void>(() => {});
  const reloadWorkbookRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isDesktopApp) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        setExportCenterOpen(true);
      } else if (e.ctrlKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (currentViewRef.current === "entry") handleToolbarSaveRef.current();
      } else if (e.ctrlKey && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        setExportCenterOpen(true);
      } else if (e.ctrlKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        // App-level undo of the last field edit; falls back to native undo
        // (normal text editing) when there is nothing to undo.
        if (undoLastEdit()) e.preventDefault();
      } else if (e.key === "F5" && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault(); // never reload the renderer - re-read the workbook
        reloadWorkbookRef.current();
      } else if (e.key === "Enter" && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target?.tagName === "INPUT" && target.closest("[id^='entry-section-']")) {
          e.preventDefault();
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[id^='entry-section-'] input"));
          const idx = inputs.indexOf(target as HTMLInputElement);
          const next = e.shiftKey ? inputs[idx - 1] : inputs[idx + 1];
          next?.focus();
          next?.select();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktopApp]);

  // Window-level drag & drop: dropping an .xlsm/.xlsx anywhere opens it.
  useEffect(() => {
    if (!desktopBridge) return;
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const path = desktopBridge.files.getPathForFile(file);
        if (path && /\.(xlsm|xlsx)$/i.test(path)) void openWorkbook(path);
      } catch {
        /* not a filesystem file */
      }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopBridge]);

  /**
   * Switch the active facility (RC1): swaps the workbook and reloads every
   * view (dashboard/reports/history/forecast/integrity) - no restart.
   * Facility data is never mixed: the in-memory store is fully replaced by
   * the new facility's workbook snapshot.
   */
  const switchFacility = (id: string) => {
    if (!desktopBridge || !excelProvider || id === activeFacilityId) return;
    // RC2: pending edits are never silently lost - Save / Discard / Cancel.
    guardNavigation(() => void doSwitchFacility(id));
  };

  const doSwitchFacility = async (id: string) => {
    if (!desktopBridge || !excelProvider) return;
    const result = await desktopBridge.facilities.setActive(id);
    if (!result.ok) {
      notify("error", (result as { message: string }).message);
      return;
    }
    const facility = (result as { ok: true; facility: FacilityEntry }).facility;
    setActiveFacilityId(facility.id);
    deviceListsRef.current = { upsIds: facility.profile.devices.ups, dcIds: facility.profile.devices.dc, airFields: facility.profile.air.fields };
    excelProvider.setDeviceLists(deviceListsRef.current);
    // Set synchronously (not left to the reactive effect) so the upcoming
    // openWorkbook() call below already carries the right UPS Group
    // topology - migration must run on THIS open, not a later one.
    excelProvider.setUpsGroupContext(
      facility.profile.dashboard.upsGroups.length > 0
        ? { facilityId: facility.id, upsGroups: facility.profile.dashboard.upsGroups }
        : undefined
    );
    setEditingMonth(null);
    await openWorkbook(facility.workbook);
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

  // Desktop startup: load config + facility registry, open the active
  // facility's workbook, and listen for "Open With" file requests.
  useEffect(() => {
    if (!desktopBridge) return;
    let disposed = false;
    (async () => {
      try {
        const cfg = await desktopBridge.config.get();
        if (disposed) return;
        setAppConfig(cfg);

        // Preferences that lived in localStorage in the browser build come
        // from the portable config file on desktop.
        setLang(cfg.language);
        if (cfg.googleSheets.spreadsheetId) setSpreadsheetId(cfg.googleSheets.spreadsheetId);
        if (cfg.security.pinEnabled && cfg.security.pinHash) {
          setSecurityConfig({ pinEnabled: true, pinHash: cfg.security.pinHash });
          setIsAppLocked(true);
        }

        // Facility registry (RC1): the active facility decides the workbook.
        const registry = await desktopBridge.facilities.list();
        if (disposed) return;
        setFacilities(registry.facilities);
        setActiveFacilityId(registry.activeFacilityId);
        const facility = registry.facilities.find(f => f.id === registry.activeFacilityId) ?? null;
        if (facility) {
          deviceListsRef.current = {
            upsIds: facility.profile.devices.ups,
            dcIds: facility.profile.devices.dc,
            airFields: facility.profile.air.fields
          };
          excelProvider?.setDeviceLists(deviceListsRef.current);
          excelProvider?.setUpsGroupContext(
            facility.profile.dashboard.upsGroups.length > 0
              ? { facilityId: facility.id, upsGroups: facility.profile.dashboard.upsGroups }
              : undefined
          );
        }

        let target: string | null = facility?.workbook ?? null;
        if (!target) {
          if (cfg.startupBehavior === "default") target = cfg.defaultWorkbookPath;
          else if (cfg.startupBehavior === "last") target = cfg.lastWorkbookPath ?? cfg.defaultWorkbookPath;
          if (!target && cfg.startupBehavior !== "ask") {
            const info = await desktopBridge.app.getInfo();
            target = info.bundledWorkbookPath;
          }
        }
        if (target && cfg.startupBehavior !== "ask") await openWorkbook(target);
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
                if (isGoogleConnected) runGoogleSheetsImport(spreadsheetId).catch(() => {});
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

  // RC2 workflow: picking a month with no record offers to create it.
  const [pendingCreateMonth, setPendingCreateMonth] = useState<string | null>(null);

  // RC3: entry sections register commit/reset APIs; drafts feed live
  // completion; batch saves suppress per-section persistence so the sticky
  // toolbar writes the workbook exactly once.
  const sectionApisRef = useRef<Record<string, EntrySectionApi | null>>({});
  const draftsRef = useRef<{ ups?: UpsRecord[]; air?: AirRecord; dc?: DcRecord[]; energy?: EnergyCostRecord }>({});
  const [draftTick, setDraftTick] = useState(0);
  const batchSaveRef = useRef(false);

  const registerSection = (name: "ups" | "air" | "dc" | "energy") => (api: EntrySectionApi | null) => {
    sectionApisRef.current[name] = api;
  };
  const reportDraft = <K extends "ups" | "air" | "dc" | "energy">(name: K) => (draft: unknown) => {
    (draftsRef.current as Record<string, unknown>)[name] = draft;
    setDraftTick(t => t + 1);
    // Editing a flagged section clears its missing-field highlight.
    setHighlightSections(prev => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  /** The active month's record with any unsaved table drafts overlaid. */
  const draftActiveLog = useMemo<MonthlyLog | null>(() => {
    if (!activeLog) return null;
    return {
      ...activeLog,
      ups: draftsRef.current.ups ?? activeLog.ups,
      air: draftsRef.current.air ?? activeLog.air,
      dc: draftsRef.current.dc ?? activeLog.dc,
      energyCost: draftsRef.current.energy ?? activeLog.energyCost
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLog, draftTick]);

  /** Live entry completion for the active month (drafts included). */
  const entryCompletion = useMemo(() => computeCompletion(draftActiveLog), [draftActiveLog]);

  const hasDraftChanges = useMemo(
    () => Object.values(sectionApisRef.current).some((api: EntrySectionApi | null) => api?.hasChanges()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftTick]
  );

  // RC4: required-field validation. Rules come from the facility profile
  // (configuration-driven); saves of incomplete records are rejected with a
  // popup listing every missing field, highlights and scroll-to-first.
  const [validationIssues, setValidationIssues] = useState<MissingField[] | null>(null);
  const [highlightSections, setHighlightSections] = useState<Set<string>>(new Set());

  type SectionName = "ups" | "air" | "dc" | "energy";

  const validateSections = (log: MonthlyLog, sections: SectionName[]): MissingField[] => {
    const rules = activeFacility?.profile.validation;
    if (!rules || !rules.requireAllFields) return [];
    const target = sections.filter(sec => rules.requiredSections.includes(sec));
    if (target.length === 0) return [];
    return listMissingFields(log).filter(m => target.includes(m.section));
  };

  const raiseValidation = (fields: MissingField[]) => {
    setValidationIssues(fields);
    setHighlightSections(new Set(fields.map(f => f.section)));
    // RC3: scroll/focus/highlight the first invalid field immediately - the
    // validation dialog is displayed simultaneously.
    const first = fields[0];
    if (first) {
      document.getElementById(`entry-section-${first.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => {
        document
          .querySelector<HTMLInputElement>(`#entry-section-${first.section} input:placeholder-shown`)
          ?.focus({ preventScroll: true });
      }, 450);
    }
  };

  /** RC3 jump-to-error: scroll to a section, focus + highlight its first empty field. */
  const jumpToSection = (section: "ups" | "air" | "dc" | "energy") => {
    const container = document.getElementById(`entry-section-${section}`);
    if (!container) return;
    container.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightSections(prev => {
      const next = new Set(prev);
      next.add(section);
      return next;
    });
    setTimeout(() => {
      const input =
        container.querySelector<HTMLInputElement>("input:placeholder-shown") ?? container.querySelector<HTMLInputElement>("input");
      input?.focus({ preventScroll: true });
      input?.select?.();
    }, 400);
  };

  const closeValidation = () => {
    const first = validationIssues?.[0];
    setValidationIssues(null);
    if (first) {
      document.getElementById(`entry-section-${first.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>(`#entry-section-${first.section} input:placeholder-shown`);
        input?.focus();
      }, 450);
    }
  };

  // --- RC2: UNSAVED-CHANGES NAVIGATION PROTECTION ---
  // Changing facility, year or month with pending edits opens a
  // Save / Discard / Cancel dialog. Edits are never silently discarded.

  /** Commit every entry section's draft into the in-memory store (one batch). */
  const commitAllDrafts = () => {
    batchSaveRef.current = true;
    try {
      Object.values(sectionApisRef.current).forEach((api: EntrySectionApi | null) => api?.commit());
    } finally {
      batchSaveRef.current = false;
    }
  };

  /** Throw away every entry section's draft (back to the stored record). */
  const resetAllDrafts = () => {
    Object.values(sectionApisRef.current).forEach((api: EntrySectionApi | null) => api?.reset());
    draftsRef.current = {};
    setDraftTick(t => t + 1);
  };

  const guardNavigation = (run: () => void) => {
    if (isDirty || hasDraftChanges) setPendingNav({ run });
    else run();
  };

  /** Unsaved-changes dialog: Save first, then continue where the user was going. */
  const pendingNavSave = async () => {
    const nav = pendingNav;
    setPendingNav(null);
    if (!nav) return;
    // RC4 still applies: incomplete records are never saved.
    if (draftActiveLog) {
      const missing = validateSections(draftActiveLog, ["ups", "air", "dc", "energy"]);
      if (missing.length > 0) return raiseValidation(missing);
    }
    commitAllDrafts();
    if (isDesktopApp && workbook) {
      const ok = await persistWorkbook();
      if (ok) nav.run();
    } else {
      reloadData();
      nav.run();
    }
  };

  /** Unsaved-changes dialog: Discard the pending edits, then continue. */
  const pendingNavDiscard = async () => {
    const nav = pendingNav;
    setPendingNav(null);
    if (!nav) return;
    resetAllDrafts();
    if (isDirty && excelProvider && workbook) {
      // The in-memory store already diverged from the file - reload the file.
      try {
        applyWorkbookSnapshot(await excelProvider.reload());
      } catch {
        setIsDirty(false); // unreadable right now; the access monitor takes over
      }
    }
    nav.run();
  };

  const handleWorkflowSelectMonth = (month: string, exists: boolean) => {
    if (month === selectedMonth) return;
    guardNavigation(() => {
      // Stale drafts (and undo entries, which target the same still-mounted
      // <input> nodes) must never leak into another month's record.
      draftsRef.current = {};
      setDraftTick(t => t + 1);
      if (exists) {
        const tSwitch = performance.now();
        selectMonthContext(month);
        recordPerfAfterPaint("switchMonthMs", tSwitch);
      } else {
        setPendingCreateMonth(month);
      }
    });
  };

  /** Sticky toolbar Save: commit every section's draft, then persist once. */
  const runBatchSave = () => {
    commitAllDrafts();
    if (isDesktopApp && workbook) {
      void persistWorkbook();
    } else {
      reloadData();
    }
  };

  const handleToolbarSave = () => {
    if (readOnly) return notifyReadOnly();
    if (draftActiveLog) {
      const missing = validateSections(draftActiveLog, ["ups", "air", "dc", "energy"]);
      if (missing.length > 0) return raiseValidation(missing);
    }
    const isHistorical = selectedMonth !== maxMonth;
    if (isHistorical || editingMonth) {
      // One confirmation for the whole batch (not one per section).
      setPendingSave({ type: "ups", execute: runBatchSave });
    } else {
      runBatchSave();
    }
  };

  useEffect(() => {
    handleToolbarSaveRef.current = handleToolbarSave;
    reloadWorkbookRef.current = () => {
      if (workbook?.path && !isBusyRef.current) void openWorkbook(workbook.path);
    };
  });

  const handleToolbarReset = () => {
    resetAllDrafts();
  };

  /** Toolbar Export opens the Export Center (RC6). */
  const handleToolbarExport = () => {
    setExportCenterOpen(true);
  };

  // --- EXPORT CENTER (RC6) ---
  const [exportCenterOpen, setExportCenterOpen] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportRequestId, setExportRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopBridge) return;
    return desktopBridge.events.onExportProgress(progress => {
      if (!exportRequestId || progress.requestId === exportRequestId) setExportProgress(progress);
    });
  }, [desktopBridge, exportRequestId]);

  // UPS Group History migration (excel:open/reload): non-blocking progress
  // toasts. Runs at most once per workbook - most opens never fire this at
  // all because the sheet already exists, so this stays silent in the
  // common case.
  useEffect(() => {
    if (!desktopBridge) return;
    return desktopBridge.events.onMigrationProgress(({ stage }) => {
      const messages: Record<string, { th: string; en: string } | undefined> = {
        "not-found": {
          th: "ไม่พบประวัติกลุ่ม UPS - กำลังย้ายข้อมูลย้อนหลังอัตโนมัติ...",
          en: "UPS Group History not found - migrating historical data automatically..."
        },
        complete: {
          th: "ย้ายข้อมูลประวัติกลุ่ม UPS สำเร็จ",
          en: "UPS Group History migration complete"
        }
      };
      const message = messages[stage];
      if (message) notify("info", lang === "th" ? message.th : message.en);
    });
  }, [desktopBridge, lang]);

  const exportBaseName = useMemo(() => {
    const facility = (activeFacility?.name ?? "Facility").replace(/\s+/g, "");
    return `${facility}_${selectedMonth || new Date().toISOString().slice(0, 7)}_Report`;
  }, [activeFacility, selectedMonth]);

  /** Lets React remove export UI before Chromium captures the current page. */
  const waitForCleanExportCapture = async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await document.fonts?.ready;
    await Promise.all(Array.from(document.images).map(image => image.complete ? Promise.resolve() : new Promise<void>(resolve => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    })));
    await new Promise(resolve => setTimeout(resolve, 50));
  };

  /** One entry point for every export format (toolbar, filter bar, Ctrl+E). */
  const runExport = async (kind: ExportKind) => {
    if (!desktopBridge) {
      notify("info", lang === "th" ? "การส่งออกใช้ได้ในเวอร์ชันเดสก์ท็อป" : "Exports are available in the desktop app.");
      return;
    }
    const logsForExport = syncedLogs ?? loadAllLogs();
    const facility = activeFacility?.name ?? "Facility";
    try {
      let result: { ok: boolean } & Record<string, unknown>;
      if (kind === "all-report") {
        if (!workbook?.path) throw new Error("Open a workbook before exporting the combined report.");
        const requestId = crypto.randomUUID();
        setExportRequestId(requestId);
        setExportProgress({ requestId, stage: "preparing", detail: "Starting export" });
        result = await desktopBridge.exportCenter.allReport({
          requestId,
          defaultName: `${facility.replace(/\s+/g, "")}_All_Report`,
          workbookPath: workbook.path,
          facility,
          dashboard: activeFacility?.profile.dashboard,
          selectedMonth: selectedMonth || null,
          appVersion: appVersion ?? "Unknown"
        });
      } else if (kind === "pdf") {
        result = await desktopBridge.exportCenter.pdf({ defaultName: exportBaseName });
      } else if (kind === "png") {
        result = await desktopBridge.exportCenter.png({ defaultName: exportBaseName });
      } else if (kind === "excel") {
        result = await desktopBridge.exportCenter.excel({ defaultName: exportBaseName, facility, logs: logsForExport });
      } else if (kind === "csv") {
        result = await desktopBridge.exportFile({ defaultName: `${exportBaseName}.csv`, content: buildCombinedCsv(logsForExport) });
      } else {
        result = await desktopBridge.exportCenter.zip({
          defaultName: exportBaseName,
          facility,
          logs: logsForExport,
          csvs: buildSectionCsvs(logsForExport),
          integrityText: buildIntegrityText(facility, workbook?.sourceLabel ?? "-", workbook?.health, workbook?.integrity)
        });
      }
      if (!result.ok) {
        notify("error", String((result as { message?: string }).message ?? "Export failed"));
      } else if (!("canceled" in result)) {
        notify("success", lang === "th" ? `ส่งออกแล้ว: ${result.path}` : `Exported: ${result.path}`);
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      if (kind === "all-report") {
        setExportRequestId(null);
        setExportProgress(null);
      }
    }
  };

  const confirmCreateMonth = () => {
    if (!pendingCreateMonth) return;
    if (readOnly) {
      setPendingCreateMonth(null);
      notifyReadOnly();
      return;
    }
    // A new month copies structure only (empty device rows from the facility
    // profile) - never another month's data.
    saveLogForMonth(pendingCreateMonth, emptyLogForMonth(pendingCreateMonth));
    const all = loadAllLogs();
    setLogs(all);
    if (isDesktopApp && workbook) {
      setSyncedLogs(all); // dashboards refresh immediately
      setIsDirty(true); // the new record reaches the workbook on next save
    }
    // The new month's fields reuse the same DOM nodes as whatever month was
    // showing - any pending undo entry must not carry across.
    selectMonthContext(pendingCreateMonth);
    setPendingCreateMonth(null);
  };

  const maxMonth = useMemo(() => {
    if (logs.length === 0) return getPreviousMonthStr();
    return logs.reduce((max, log) => log.month > max ? log.month : max, logs[0].month);
  }, [logs]);

  // --- IN-MEMORY DATA (RE)LOAD ---
  const reloadData = () => {
    // Security config: desktop reads it from config/config.json (see the
    // desktop startup effect); the browser build keeps using localStorage.
    if (!isDesktopApp) {
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
      selectMonthContext(prevMonth);
    } else {
      const exists = allLogs.some(l => l.month === selectedMonth);
      if (!exists) {
        selectMonthContext(prevMonth);
      }
    }
  };

  useEffect(() => {
    reloadData();
  }, []);

  // Single authentication listener - the only subscription to the active
  // Google connection driver's state in the app (desktop: Electron main
  // process OAuth via IPC; browser: Firebase, unchanged).
  useEffect(() => {
    return googleDriver.onStateChange(state => {
      setGoogleConnectionState(state);
      // Desktop's syncedLogs comes from the local Excel workbook via
      // openWorkbook(), entirely independent of Google - a Google
      // connect/disconnect/error must never blank it out (a Google failure
      // must never break Excel mode). Only the browser/iframe deployment
      // sources syncedLogs from Google Sheets itself, where clearing stale
      // data on disconnect is still correct.
      if (!isDesktopApp && state.status !== "connected") setSyncedLogs(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single startup / spreadsheet-change import trigger. Fires exactly once whenever
  // authentication completes or the target spreadsheet changes - this is the only
  // place that automatically triggers a Google Sheets import.
  // Desktop: the workbook is the source of truth for reports, so the Google
  // import never runs automatically there (Sheets stays a manual, optional sync).
  useEffect(() => {
    if (isGoogleConnected && !isDesktopApp) {
      runGoogleSheetsImport(spreadsheetId).catch(() => {});
    }
  }, [isGoogleConnected, spreadsheetId, isDesktopApp]);

  // Update activeLog state when selectedMonth changes
  useEffect(() => {
    if (selectedMonth) {
      const log = loadLogForMonth(selectedMonth, deviceListsRef.current?.upsIds, deviceListsRef.current?.dcIds);
      setActiveLog(log);
    }
  }, [selectedMonth, logs]);

  // Apply the configured theme (desktop). Tailwind color variables are
  // remapped by the html.theme-light rules in index.css.
  useEffect(() => {
    document.documentElement.classList.toggle("theme-light", appConfig?.theme === "light");
    document.documentElement.classList.toggle("theme-dark", appConfig?.theme !== "light");
  }, [appConfig?.theme]);

  // --- ACTION HANDLERS ---
  // After the in-memory store is updated, desktop persists straight into the
  // workbook (with backup + lock handling); the browser build keeps the
  // original in-memory + Google Sheets behavior.
  const commitEntrySave = () => {
    // During a toolbar batch save, sections only update the in-memory store;
    // the toolbar persists the workbook once at the end.
    if (batchSaveRef.current) return;
    if (isDesktopApp && workbook) {
      void persistWorkbook();
    } else {
      reloadData();
    }
  };

  const handleSaveUps = (records: UpsRecord[]) => {
    if (!activeLog) return;
    if (readOnly) return notifyReadOnly();
    if (!batchSaveRef.current) {
      const missing = validateSections({ ...activeLog, ups: records }, ["ups"]);
      if (missing.length > 0) return raiseValidation(missing);
    }
    const isHistorical = selectedMonth !== maxMonth;
    const saveAction = () => {
      const timestamp = formatTimestamp(new Date());
      // Read the freshest in-memory record, not the (possibly batch-stale)
      // `activeLog` React state - during a toolbar batch save, earlier
      // sections in the same batch have already written into the in-memory
      // store, and activeLog is deliberately not refreshed mid-batch
      // (commitEntrySave short-circuits). Spreading activeLog here would
      // silently revert those earlier sections' edits.
      const updatedLog: MonthlyLog = {
        ...loadLogForMonth(selectedMonth, deviceListsRef.current?.upsIds, deviceListsRef.current?.dcIds),
        ups: records,
        lastSavedUps: timestamp
      };
      saveLogForMonth(selectedMonth, updatedLog);
      commitEntrySave();
    };

    if ((isHistorical || editingMonth) && !batchSaveRef.current) {
      setPendingSave({ type: "ups", execute: saveAction });
    } else {
      saveAction();
    }
  };

  const handleSaveSrinakarinPower = (records: UpsRecord[], inputs: SrinakarinInputSnapshot) => {
    if (!activeLog) return;
    if (readOnly) return notifyReadOnly();
    if (!batchSaveRef.current) {
      const missing = validateSections({ ...activeLog, ups: records, srinakarinInputs: inputs }, ["ups"]);
      if (missing.length > 0) return raiseValidation(missing);
    }
    const isHistorical = selectedMonth !== maxMonth;
    const saveAction = () => {
      const timestamp = formatTimestamp(new Date());
      const updatedLog: MonthlyLog = {
        ...loadLogForMonth(selectedMonth, deviceListsRef.current?.upsIds, deviceListsRef.current?.dcIds),
        ups: records,
        srinakarinInputs: inputs,
        lastSavedUps: timestamp
      };
      saveLogForMonth(selectedMonth, updatedLog);
      commitEntrySave();
    };

    if ((isHistorical || editingMonth) && !batchSaveRef.current) {
      setPendingSave({ type: "ups", execute: saveAction });
    } else {
      saveAction();
    }
  };

  const handleSaveAir = (record: AirRecord) => {
    if (!activeLog) return;
    if (readOnly) return notifyReadOnly();
    if (!batchSaveRef.current) {
      const missing = validateSections({ ...activeLog, air: record }, ["air"]);
      if (missing.length > 0) return raiseValidation(missing);
    }
    const isHistorical = selectedMonth !== maxMonth;
    const saveAction = () => {
      const timestamp = formatTimestamp(new Date());
      const updatedLog: MonthlyLog = {
        ...loadLogForMonth(selectedMonth, deviceListsRef.current?.upsIds, deviceListsRef.current?.dcIds),
        air: record,
        lastSavedAir: timestamp
      };
      saveLogForMonth(selectedMonth, updatedLog);
      commitEntrySave();
    };

    if ((isHistorical || editingMonth) && !batchSaveRef.current) {
      setPendingSave({ type: "air", execute: saveAction });
    } else {
      saveAction();
    }
  };

  const handleSaveDc = (records: DcRecord[]) => {
    if (!activeLog) return;
    if (readOnly) return notifyReadOnly();
    if (!batchSaveRef.current) {
      const missing = validateSections({ ...activeLog, dc: records }, ["dc"]);
      if (missing.length > 0) return raiseValidation(missing);
    }
    const isHistorical = selectedMonth !== maxMonth;
    const saveAction = () => {
      const timestamp = formatTimestamp(new Date());
      const updatedLog: MonthlyLog = {
        ...loadLogForMonth(selectedMonth, deviceListsRef.current?.upsIds, deviceListsRef.current?.dcIds),
        dc: records,
        lastSavedDc: timestamp
      };
      saveLogForMonth(selectedMonth, updatedLog);
      commitEntrySave();
    };

    if ((isHistorical || editingMonth) && !batchSaveRef.current) {
      setPendingSave({ type: "dc", execute: saveAction });
    } else {
      saveAction();
    }
  };

  const handleSaveEnergyCost = (record: EnergyCostRecord) => {
    if (!activeLog) return;
    if (readOnly) return notifyReadOnly();
    if (!batchSaveRef.current) {
      const missing = validateSections({ ...activeLog, energyCost: record }, ["energy"]);
      if (missing.length > 0) return raiseValidation(missing);
    }
    const isHistorical = selectedMonth !== maxMonth;
    const saveAction = () => {
      const timestamp = formatTimestamp(new Date());
      const updatedLog: MonthlyLog = {
        ...loadLogForMonth(selectedMonth, deviceListsRef.current?.upsIds, deviceListsRef.current?.dcIds),
        energyCost: record,
        lastSavedEnergyCost: timestamp
      };
      saveLogForMonth(selectedMonth, updatedLog);
      commitEntrySave();
    };

    if ((isHistorical || editingMonth) && !batchSaveRef.current) {
      setPendingSave({ type: "energy", execute: saveAction });
    } else {
      saveAction();
    }
  };

  const handleCreateNewMonth = (e: React.FormEvent) => {
    e.preventDefault();
    setAddMonthError("");

    if (readOnly) {
      setAddMonthError(lang === "th" ? "โหมดอ่านอย่างเดียว - สร้างบันทึกใหม่ไม่ได้" : "Read-only mode - cannot create a record.");
      return;
    }
    if (!newMonthInput) {
      setAddMonthError(lang === "th" ? "กรุณาเลือกเดือนและปี" : "Please select month and year");
      return;
    }

    const exists = logs.some(l => l.month === newMonthInput);
    if (exists) {
      setAddMonthError(lang === "th" ? "มีบันทึกของเดือนนี้อยู่แล้วในระบบ" : "Log for this month already exists");
      return;
    }

    const newLog = emptyLogForMonth(newMonthInput);
    saveLogForMonth(newMonthInput, newLog);

    // Refresh states
    if (isDesktopApp && workbook) {
      setSyncedLogs(loadAllLogs()); // dashboards refresh immediately
      setIsDirty(true); // the new record reaches the workbook on next save
    }
    selectMonthContext(newMonthInput);
    setShowAddMonthModal(false);
    setNewMonthInput("");
    reloadData();
  };

  const handleUpdateSecurity = (newConfig: SecurityConfig) => {
    setSecurityConfig(newConfig);
    if (isDesktopApp && desktopBridge) {
      // Desktop: persist to the portable config file, never localStorage.
      void desktopBridge.config
        .update({ security: { pinEnabled: newConfig.pinEnabled, pinHash: newConfig.pinHash } })
        .then(setAppConfig)
        .catch(err => notify("error", `Could not save PIN settings: ${err instanceof Error ? err.message : err}`));
    } else {
      localStorage.setItem("facility_security_config", JSON.stringify(newConfig));
    }
  };

  const handleLanguageChange = (next: "th" | "en") => {
    setLang(next);
    if (isDesktopApp && desktopBridge) {
      void desktopBridge.config.update({ language: next }).then(setAppConfig).catch(() => undefined);
    }
  };

  /** Settings page pushed a new config: mirror the parts held in App state. */
  const handleConfigChange = (cfg: AppConfig) => {
    setAppConfig(cfg);
    setLang(cfg.language);
  };

  const applyRecovery = () => {
    if (!recoveryOffer) return;
    clearEntryUndoHistory(undoStackRef);
    recoveryOffer.logs.forEach(l => saveLogForMonth(l.month, l));
    setLogs(loadAllLogs());
    setIsDirty(true);
    setRecoveryOffer(null);
    void persistWorkbook();
  };

  const discardRecovery = () => {
    setRecoveryOffer(null);
    void desktopBridge?.recovery.clear();
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
      <div className={`max-w-[1600px] 2xl:max-w-[1760px] mx-auto px-4 sm:px-8 lg:px-10 py-8 space-y-8 ${isDesktopApp ? "pb-16" : ""}`}>
        
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
            {/* Facility Switcher (desktop, RC1) */}
            {isDesktopApp && (
              <FacilitySelector
                facilities={facilities}
                activeId={activeFacilityId}
                isBusy={isWorkbookBusy}
                lang={lang}
                onSelect={id => void switchFacility(id)}
              />
            )}

            {/* Language Switcher */}
            <button
              onClick={() => handleLanguageChange(lang === "th" ? "en" : "th")}
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

        {/* SEGMENTED NAVIGATION BAR */}
        <nav
          className={`grid grid-cols-1 ${
            isDesktopApp ? "sm:grid-cols-2 lg:grid-cols-6" : "sm:grid-cols-3"
          } gap-2 bg-slate-900 border border-slate-850 p-1.5 rounded-2xl shadow-md`}
        >
          <button
            onClick={() => setCurrentView("dashboard")}
            className={`px-4 py-3.5 text-xs font-bold rounded-xl flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
              currentView === "dashboard"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
            }`}
          >
            <BarChart4 className="w-4 h-4 text-indigo-400" />
            <span>{lang === "th" ? "หน้าสรุปแดชบอร์ด" : "Dashboard Summary"}</span>
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
            <span>{lang === "th" ? "หน้ากรอกข้อมูล" : "Data Entry Sheet"}</span>
          </button>

          {isDesktopApp && (
            <button
              onClick={() => setCurrentView("rackCapacity")}
              className={`px-4 py-3.5 text-xs font-bold rounded-xl flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
                currentView === "rackCapacity"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
              }`}
            >
              <Server className="w-4 h-4 text-fuchsia-400" />
              <span>{lang === "th" ? "ความจุแร็คและการใช้งาน" : "Rack Capacity and Utilization"}</span>
            </button>
          )}

          <button
            onClick={() => setCurrentView("history")}
            className={`px-4 py-3.5 text-xs font-bold rounded-xl flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
              currentView === "history"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
            }`}
          >
            <TableProperties className="w-4 h-4 text-amber-400" />
            <span>{lang === "th" ? "ประวัติรายเดือนทั้งหมด" : "Historical Logs"}</span>
          </button>

          {isDesktopApp && (
            <button
              onClick={() => setCurrentView("comparison")}
              className={`px-4 py-3.5 text-xs font-bold rounded-xl flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
                currentView === "comparison"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
              }`}
            >
              <BarChart4 className="w-4 h-4 text-cyan-400" />
              <span>{lang === "th" ? "เปรียบเทียบไซต์" : "Site Comparison"}</span>
            </button>
          )}

          {isDesktopApp && (
            <button
              onClick={() => setCurrentView("settings")}
              className={`px-4 py-3.5 text-xs font-bold rounded-xl flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
                currentView === "settings"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-850/50"
              }`}
            >
              <Settings className="w-4 h-4 text-emerald-400" />
              <span>{lang === "th" ? "ตั้งค่า & ตรวจสอบข้อมูล" : "Settings & Data Validation"}</span>
            </button>
          )}
        </nav>

        {/* RC2: PERSISTENT READ-ONLY MODE BANNER (desktop) */}
        {readOnly && (
          <div
            data-testid="readonly-banner"
            className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-2xl flex items-start gap-3 text-xs text-rose-300 animate-fadeIn"
          >
            <Lock className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <div>
              <span className="font-bold uppercase tracking-wider block text-[10px] mb-0.5 text-rose-400">
                {lang === "th" ? "โหมดอ่านอย่างเดียว" : "Read-Only Mode"}
              </span>
              <span>{readOnlyReason}</span>
              <span className="block text-slate-400 mt-1">
                {lang === "th"
                  ? "ดูข้อมูล ค้นหา รายงาน และส่งออกได้ตามปกติ - การบันทึก บันทึกอัตโนมัติ และการสร้างบันทึกใหม่ถูกปิดไว้ชั่วคราว"
                  : "Viewing, search, reports and export remain available - Save, Auto Save and Create Monthly Record are temporarily disabled."}
              </span>
            </div>
          </div>
        )}

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
          <div className="space-y-8 pb-24">
            {/* WORKBOOK STATUS & FILE ACTIONS (desktop) */}
            {isDesktopApp && workbook && (
              <WorkbookBar
                workbook={workbook}
                isDirty={isDirty}
                isBusy={isWorkbookBusy}
                lang={lang}
                writable={access ? access.writable : null}
                lastLoadedAt={lastLoadedAt}
                lastSaved={lastPersistAt}
                workbookVersion={access?.mtime ? formatTimestamp(new Date(access.mtime)) : null}
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

            {/* WORKFLOW HEADER (RC2): Facility → Year → Month → Entry */}
            <div className="space-y-2">
              <EntryWorkflowHeader
                lang={lang}
                facilityName={activeFacility?.name ?? null}
                facilityLogo={activeFacility?.profile.logo ?? null}
                workbookLabel={workbook?.sourceLabel ?? null}
                months={logs.map(l => l.month)}
                selectedMonth={selectedMonth}
                completion={entryCompletion}
                health={workbook?.health ?? null}
                lastSaved={lastPersistAt}
                onSelectMonth={handleWorkflowSelectMonth}
              />
              <div className="flex justify-end">
                <button
                  onClick={() => setShowAddMonthModal(true)}
                  className="px-3 py-1.5 text-[11px] text-slate-400 hover:text-slate-200 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t.addMonth}</span>
                </button>
              </div>
            </div>

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
                    selectMonthContext(maxMonth);
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
                <div id="entry-section-ups" className={highlightSections.has("ups") ? "highlight-missing" : ""}>
                  {activeFacility?.id === "srinakarin" ? (
                    <SrinakarinPowerPhaseTable
                      monthStr={selectedMonth}
                      initialLog={activeLog}
                      lastSaved={activeLog.lastSavedUps}
                      onSave={handleSaveSrinakarinPower}
                      registerApi={registerSection("ups")}
                      onDraftChange={reportDraft("ups")}
                    />
                  ) : (
                    <UpsTable
                      monthStr={selectedMonth}
                      initialRecords={activeLog.ups}
                      lastSaved={activeLog.lastSavedUps}
                      onSave={handleSaveUps}
                      registerApi={registerSection("ups")}
                      onDraftChange={reportDraft("ups")}
                    />
                  )}
                </div>

                {/* Air Conditioning section */}
                <div id="entry-section-air" className={highlightSections.has("air") ? "highlight-missing" : ""}>
                  <AirTable
                    monthStr={selectedMonth}
                    initialRecord={activeLog.air}
                    lastSaved={activeLog.lastSavedAir}
                    onSave={handleSaveAir}
                    registerApi={registerSection("air")}
                    onDraftChange={reportDraft("air")}
                    meterFields={activeFacility?.profile.air.fields}
                    meterLabels={activeFacility?.profile.air.labels}
                  />
                </div>

                {/* DC Power Panel section */}
                <div id="entry-section-dc" className={highlightSections.has("dc") ? "highlight-missing" : ""}>
                  <DcTable
                    monthStr={selectedMonth}
                    initialRecords={activeLog.dc}
                    lastSaved={activeLog.lastSavedDc}
                    onSave={handleSaveDc}
                    registerApi={registerSection("dc")}
                    onDraftChange={reportDraft("dc")}
                  />
                </div>

                {/* Building Energy & Cost section */}
                <div id="entry-section-energy" className={highlightSections.has("energy") ? "highlight-missing" : ""}>
                  <EnergyCostTable
                    monthStr={selectedMonth}
                    initialRecord={activeLog.energyCost}
                    lastSaved={activeLog.lastSavedEnergyCost}
                    onSave={handleSaveEnergyCost}
                    registerApi={registerSection("energy")}
                    onDraftChange={reportDraft("energy")}
                  />
                </div>

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
                driver={googleDriver}
                connectionState={googleConnectionState}
                spreadsheetId={spreadsheetId}
                onSpreadsheetIdChange={handleSpreadsheetIdChange}
                lastSyncedTime={lastSyncedTime}
                onImport={handleManualImport}
              />
            )}

            {/* DATA MANAGEMENT BAR (browser build only - the desktop app
                manages its database through the workbook + backups) */}
            {!isDesktopApp && <DataManagement onDataChange={reloadData} />}

            {/* STICKY BOTTOM TOOLBAR (RC3) */}
            <StickyEntryToolbar
              lang={lang}
              completion={entryCompletion}
              lastSaved={
                lastPersistAt ??
                activeLog?.lastSavedUps ??
                activeLog?.lastSavedAir ??
                activeLog?.lastSavedDc ??
                activeLog?.lastSavedEnergyCost ??
                null
              }
              workbookStatus={
                !isDesktopApp
                  ? "saved"
                  : !workbook
                    ? "none"
                    : isWorkbookBusy
                      ? "busy"
                      : readOnly
                        ? "readonly"
                        : workbook.lock?.locked || workbook.lock?.excelOwnerFilePresent
                          ? "locked"
                          : isDirty || hasDraftChanges
                            ? "dirty"
                            : "saved"
              }
              hasDraftChanges={hasDraftChanges || isDirty}
              readOnly={readOnly}
              aboveStatusBar={isDesktopApp}
              facilityName={activeFacility?.name ?? null}
              monthLabel={selectedMonth || null}
              provider={isDesktopApp ? "Excel" : "Browser"}
              onSaveAll={handleToolbarSave}
              onResetAll={handleToolbarReset}
              onExport={handleToolbarExport}
              onJumpToSection={jumpToSection}
            />
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
                rackCapacity={workbook?.rackCapacity}
                upsMapping={workbook?.upsMapping}
                facility={activeFacility}
                onExport={isDesktopApp ? format => void runExport(format) : undefined}
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

        {/* --- VIEW: RACK CAPACITY MANAGEMENT (desktop) --- */}
        {currentView === "rackCapacity" && isDesktopApp && excelProvider && (
          <div className="space-y-6 animate-fadeIn">
            <RackCapacitySummaryCard rackCapacity={workbook?.rackCapacity} lang={lang} rackUnitCapacity={workbook?.rackUnitCapacity ?? []} unitCapacityMonth={rackCapacityMonth} />
            <RackUnitCapacityPanel
              rows={workbook?.rackUnitCapacity ?? []}
              provider={excelProvider}
              lang={lang}
              month={rackCapacityMonth}
              onMonthChange={setRackCapacityMonth}
              onSaved={rows => setWorkbook(prev => (prev ? { ...prev, rackUnitCapacity: rows } : prev))}
            />
            <RackCapacityEditor
              rackCapacity={workbook?.rackCapacity ?? null}
              provider={excelProvider}
              lang={lang}
              month={rackCapacityMonth}
              onMonthChange={setRackCapacityMonth}
              onSaved={(updated, history) => setWorkbook(prev => (prev ? { ...prev, rackCapacity: updated, rackCapacityHistory: history } : prev))}
            />
            <RackCapacityHistoryPanel rows={workbook?.rackCapacityHistory ?? []} lang={lang} />
          </div>
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
                upsGroupHistory={workbook?.upsGroupHistory}
                activeFacilityId={activeFacility?.id ?? null}
                rackCapacityHistory={workbook?.rackCapacityHistory ?? []}
                rackUnitCapacity={workbook?.rackUnitCapacity ?? []}
                onEditMonth={(monthStr) => {
                  setEditingMonth(monthStr);
                  selectMonthContext(monthStr);
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

        {/* --- VIEW 4: SITE COMPARISON (desktop, read-only) --- */}
        {currentView === "comparison" && isDesktopApp && excelProvider && facilities.length > 0 && (
          <FacilityComparison facilities={facilities} provider={excelProvider} lang={lang} />
        )}

        {/* --- VIEW 5: SETTINGS & INTEGRITY CENTER (desktop) --- */}
        {currentView === "settings" && isDesktopApp && desktopBridge && appConfig && (
          <div className="space-y-6 animate-fadeIn">
            {workbook && (
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
                  if (workbook.path) void desktopBridge.shell.showItemInFolder(workbook.path);
                }}
              />
            )}
            {workbook && (
              <IntegrityCenter
                workbook={workbook}
                lang={lang}
                isBusy={isWorkbookBusy}
                onValidate={() => {
                  if (workbook.path) void openWorkbook(workbook.path);
                }}
              />
            )}
            <SettingsPanel
              bridge={desktopBridge}
              appConfig={appConfig}
              workbook={workbook}
              lang={lang}
              isBusy={isWorkbookBusy}
              onConfigChange={handleConfigChange}
              onRestoreBackup={p => void handleRestoreBackup(p)}
              onOpenWorkbookDialog={() => void openWorkbook(null, true)}
            />
          </div>
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

      {/* --- INCOMPLETE DATA VALIDATION POPUP (RC4) --- */}
      <AnimatePresence>
        {validationIssues && (
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
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-100 text-base">
                      {lang === "th" ? "ข้อมูลไม่ครบถ้วน" : "Incomplete Data"}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider mt-0.5">
                      {validationIssues.length} {lang === "th" ? "ช่องที่ยังว่าง" : "missing fields"} · {formatMonthYear(selectedMonth)}
                    </p>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-slate-300">
                  {lang === "th"
                    ? "กรุณากรอกข้อมูลให้ครบทุกช่องที่จำเป็นก่อนบันทึก ระบบจะไม่บันทึกข้อมูลที่ไม่สมบูรณ์"
                    : "Please complete all required fields. Incomplete records are never saved."}
                </p>

                <div className="max-h-56 overflow-y-auto bg-slate-950/50 border border-slate-850 rounded-xl p-3 space-y-1">
                  {validationIssues.map((f, i) => (
                    <p key={i} className="text-[11px] text-rose-300 font-mono flex items-center gap-2">
                      <span className="w-1 h-1 bg-rose-500 rounded-full shrink-0" />
                      <span className="uppercase text-[9px] font-bold text-slate-500 w-14 shrink-0">{f.section}</span>
                      {f.label}
                    </p>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={closeValidation}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold rounded-xl text-white shadow-lg shadow-indigo-600/15 transition-all cursor-pointer"
                >
                  {lang === "th" ? "ไปยังช่องแรกที่ยังว่าง" : "Go to first missing field"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- CREATE MONTHLY RECORD PROMPT (RC2) --- */}
      <AnimatePresence>
        {pendingCreateMonth && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-100 text-base">
                      {lang === "th" ? "สร้างบันทึกรายเดือน" : "Create Monthly Record"}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider mt-0.5">
                      {formatMonthYear(pendingCreateMonth)} ({pendingCreateMonth})
                    </p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-300 bg-slate-950/50 border border-slate-850 p-4 rounded-xl">
                  {lang === "th"
                    ? "ยังไม่มีบันทึกของเดือนนี้ในฐานข้อมูล ต้องการสร้างบันทึกใหม่สำหรับกรอกข้อมูลหรือไม่?"
                    : "No record exists for this month yet. Create a new monthly record to start entering data?"}
                </p>
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPendingCreateMonth(null)}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-semibold rounded-xl text-slate-300 transition-all cursor-pointer border border-slate-700/50"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={confirmCreateMonth}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold rounded-xl text-white shadow-lg shadow-indigo-600/15 transition-all cursor-pointer"
                  >
                    {lang === "th" ? "สร้างบันทึก" : "Create"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- CRASH RECOVERY OFFER (desktop) --- */}
      <AnimatePresence>
        {recoveryOffer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl">
                    <RefreshCw className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-100 text-base">
                      {lang === "th" ? "พบข้อมูลที่ยังไม่ได้บันทึก" : "Unsaved Changes Found"}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider mt-0.5">
                      {formatTimestamp(new Date(recoveryOffer.savedAt))}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs leading-relaxed text-slate-300 bg-slate-950/50 border border-slate-850 p-4 rounded-xl">
                  <p>
                    {lang === "th"
                      ? "โปรแกรมพบข้อมูลที่แก้ไขไว้แต่ยังไม่ถูกบันทึกลงไฟล์ Workbook จากการใช้งานครั้งก่อน (เช่น ปิดโปรแกรมกะทันหัน หรือบันทึกไม่สำเร็จ)"
                      : "Edits from a previous session were journaled but never written to the workbook (e.g. the app closed unexpectedly or a save failed)."}
                  </p>
                  <p className="font-medium text-indigo-300">
                    {lang === "th"
                      ? "ต้องการกู้คืนข้อมูลเหล่านี้และบันทึกลง Workbook หรือไม่?"
                      : "Restore these changes and save them into the workbook now?"}
                  </p>
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={discardRecovery}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-semibold rounded-xl text-slate-300 transition-all cursor-pointer border border-slate-700/50"
                  >
                    {lang === "th" ? "ละทิ้งข้อมูลนี้" : "Discard"}
                  </button>
                  <button
                    type="button"
                    onClick={applyRecovery}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold rounded-xl text-white shadow-lg shadow-indigo-600/15 transition-all cursor-pointer"
                  >
                    {lang === "th" ? "กู้คืนและบันทึก" : "Restore & Save"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- EXPORT CENTER (RC6) --- */}
      <ExportCenterModal
        open={exportCenterOpen}
        lang={lang}
        baseName={exportBaseName}
        onClose={() => setExportCenterOpen(false)}
        exportProgress={exportProgress}
        onCancelExport={() => {
          if (exportRequestId && desktopBridge) void desktopBridge.exportCenter.cancel(exportRequestId);
        }}
        onExport={async kind => {
          setExportCenterOpen(false);
          await waitForCleanExportCapture();
          await runExport(kind);
        }}
      />

      {/* --- UNSAVED CHANGES PROTECTION (RC2): Save / Discard / Cancel --- */}
      <AnimatePresence>
        {pendingNav && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 space-y-4" data-testid="unsaved-dialog">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-xl">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-100 text-base">
                      {lang === "th" ? "มีข้อมูลที่ยังไม่ได้บันทึก" : "Unsaved Changes"}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider mt-0.5">
                      {formatMonthYear(selectedMonth)}
                    </p>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-slate-300 bg-slate-950/50 border border-slate-850 p-4 rounded-xl">
                  {lang === "th"
                    ? "คุณกำลังจะออกจากหน้านี้โดยยังมีข้อมูลที่แก้ไขค้างอยู่ ต้องการบันทึกก่อนไปต่อ ละทิ้งการแก้ไข หรือยกเลิกการเปลี่ยนหน้า?"
                    : "You are about to navigate away with pending edits. Save them first, discard them, or cancel the switch?"}
                </p>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setPendingNav(null)}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-semibold rounded-xl text-slate-300 transition-all cursor-pointer border border-slate-700/50"
                  >
                    {lang === "th" ? "ยกเลิก" : "Cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void pendingNavDiscard()}
                    className="flex-1 py-2.5 bg-rose-700 hover:bg-rose-600 text-xs font-bold rounded-xl text-white transition-all cursor-pointer"
                  >
                    {lang === "th" ? "ละทิ้งการแก้ไข" : "Discard"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void pendingNavSave()}
                    disabled={readOnly}
                    title={readOnly ? (lang === "th" ? "โหมดอ่านอย่างเดียว" : "Read-only mode") : undefined}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-xs font-bold rounded-xl text-white shadow-lg shadow-indigo-600/15 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {lang === "th" ? "บันทึกก่อน" : "Save"}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- WORKBOOK UNAVAILABLE / AUTO-RECOVERY (RC2) --- */}
      <AnimatePresence>
        {unavailableDialogOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 space-y-4" data-testid="recovery-dialog">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-slate-100 text-base">
                      {lang === "th" ? "ไม่สามารถเข้าถึงไฟล์ Workbook" : "Workbook Unavailable"}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-semibold font-mono uppercase tracking-wider mt-0.5">
                      {workbook?.sourceLabel}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 text-xs leading-relaxed text-slate-300 bg-slate-950/50 border border-slate-850 p-4 rounded-xl">
                  <p>
                    {lang === "th"
                      ? "ระบบพยายามเชื่อมต่อไฟล์ใหม่อัตโนมัติแล้วแต่ไม่สำเร็จ (ไฟล์อาจถูกย้าย ถูกลบ หรือไดรฟ์/เครือข่ายไม่พร้อมใช้งาน)"
                      : "Automatic recovery was attempted but the workbook is still unreachable (it may have been moved or deleted, or the drive/network share is unavailable)."}
                  </p>
                  <p className="font-medium text-amber-400">
                    {lang === "th"
                      ? "ข้อมูลที่แก้ไขไว้ยังอยู่ครบในหน่วยความจำและจะไม่สูญหาย"
                      : "Your edits are still held safely in memory - nothing is lost."}
                  </p>
                </div>

                <div className="flex gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setUnavailableDialogOpen(false)}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-semibold rounded-xl text-slate-300 transition-all cursor-pointer border border-slate-700/50"
                  >
                    {lang === "th" ? "ปิด" : "Close"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUnavailableDialogOpen(false);
                      void openWorkbook(null, true);
                    }}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-750 text-xs font-bold rounded-xl text-slate-200 transition-all cursor-pointer border border-slate-700/50"
                  >
                    {lang === "th" ? "เปิดไฟล์อื่น..." : "Open File…"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void attemptRecovery().then(recovered => {
                        if (!recovered) {
                          notify("error", lang === "th" ? "ยังไม่สามารถเข้าถึงไฟล์ได้" : "The workbook is still unavailable.");
                        }
                      })
                    }
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

      {/* --- STATUS BAR (RC2, desktop) --- */}
      {isDesktopApp && (
        <StatusBar
          lang={lang}
          facilityName={activeFacility?.name ?? null}
          workbookLabel={workbook?.sourceLabel ?? null}
          selectedMonth={selectedMonth}
          provider="Excel"
          writable={workbook && access ? access.writable : null}
          healthPercent={healthPercent}
          integrityIssues={integrityIssues}
          completionPercent={activeLog ? entryCompletion.overall.percent : null}
          lastSaved={lastPersistAt}
          online={isOnline}
          version={appVersion}
        />
      )}

      {/* --- SAVE PROGRESS (RC3) --- */}
      {saveProgress && <SaveProgress lang={lang} state={saveProgress} onDismiss={() => setSaveProgress(null)} />}

      {/* --- APP-WIDE TOASTS --- */}
      <ToastHost />

    </div>
  );
}
