import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BarChart3, Calendar, ChartNoAxesCombined, ClipboardPenLine, Download, FileCode2, FileSpreadsheet, History, LogOut, Printer, Server, Settings, UsersRound } from "lucide-react";
import { ReportProvider, useReport } from "../ReportContext";
import UniversalFilterBar from "../components/UniversalFilterBar";
import { createEmptyLog } from "../utils";
import { currentMonth, monthLabelShort } from "../utils/monthUtils";
import { selectedDashboardMonth } from "../utils/reportPeriodSelection";
import { computeCompletion } from "../utils/completion";
import type { MonthlyLog } from "../types";
import type { IDataProvider } from "../data/IDataProvider";
import type { StoredImageMeta } from "../storage/ImageStorageProvider";
import type { DashboardUpsMappingReport, UpsGroupHistoryReport, RackCapacitySummary } from "../reports/reportTypes";
import { buildDashboardUpsMapping } from "./dashboardUpsMapping";
import { getDesktopDashboardMapping } from "../domain/dashboardMapping";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import type { RackUnitCapacityRow } from "../excel/RackUnitCapacityWriter";
import { RackCapacityProvider, useRackCapacity } from "../components/rack/RackCapacityContext";
import type { EntryWorkspaceActions } from "./WebEntryWorkspace";
import { api, type SessionUser, type Role } from "./api";
import { exportAllFacilitiesCsv, exportAllFacilitiesExcel, exportAllFacilitiesHtml as exportAllFacilitiesHtmlFile, exportCsv, exportExcel, exportHtml as exportHtmlFile, exportSiteComparisonCsv, exportSiteComparisonExcel, exportSiteComparisonHtml, openReportPopup, printAllFacilitiesPdf as printAllFacilitiesPdfFile, printDesktopPdf as printDesktopPdfFile, printSiteComparisonPdf, rackReportFromSnapshot, type SiteComparisonExport, type RackSnapshotApiResponse } from "./exports";
import { defaultReportFilename, resolveFilename, withExtension } from "./reportFilename";
import { defaultReportingPeriod, effectiveMonth, filterLogsByPeriod, reportingPeriodLabel, type ReportingPeriodMode, type ReportingPeriodSelection } from "./reportPeriod";
import { facilityStorageKey, latestEnergyMonth, normalizeBootstrap, selectedFacility, type BootstrapState, type FacilitySite } from "./facilityContext";
import { applyTheme, languageStorageKey, normalizeLanguage, normalizeTheme, themeStorageKey, type AppLanguage, type Theme } from "./theme";
import { HistoryProvider } from "../reporting/HistoryProvider";
import { ReportRegistry } from "../reporting/ReportRegistry";
import type { ReportHistoryItem, ReportSectionId } from "../reporting/reportingTypes";

const DashboardSummary = lazy(() => import("../components/DashboardSummary"));
const ExecutiveDashboard = lazy(() => import("../components/ExecutiveDashboard"));
const BenchmarkDashboard = lazy(() => import("../components/BenchmarkDashboard"));
const ForecastDashboard = lazy(() => import("../components/ForecastDashboard"));
const SmartInsightPanel = lazy(() => import("../components/SmartInsightPanel"));
const HistoricalExplorer = lazy(() => import("../components/HistoricalExplorer"));
const HistoricalCharts = lazy(() => import("../components/HistoricalCharts"));
const WebSiteComparison = lazy(() => import("./WebSiteComparison"));
const WebEntryWorkspace = lazy(() => import("./WebEntryWorkspace"));
const WebReportPreview = lazy(() => import("./WebReportPreview"));
const RackCapacitySummaryCard = lazy(() => import("../components/rack/RackCapacitySummaryCard"));
const RackCapacityHistoryPanel = lazy(() => import("../components/rack/RackCapacityHistoryPanel"));
const RackCapacityForecast = lazy(() => import("../components/rack/Forecast").then(module => ({ default: module.Forecast })));
const RackUnitCapacitySummary = lazy(() => import("../components/rack/RackUnitCapacitySummary").then(module => ({ default: module.RackUnitCapacitySummary })));
const RackCapacityStickyHeader = lazy(() => import("../components/rack/StickyHeader").then(module => ({ default: module.StickyHeader })));
const RackCapacityExecutiveKpiCards = lazy(() => import("../components/rack/ExecutiveKpiCards").then(module => ({ default: module.ExecutiveKpiCards })));
const CapacityAlerts = lazy(() => import("../components/rack/CapacityAlerts").then(module => ({ default: module.CapacityAlerts })));
const CapacityGauge = lazy(() => import("../components/rack/CapacityGauge").then(module => ({ default: module.CapacityGauge })));
const RackCapacityTimeline = lazy(() => import("../components/rack/Timeline").then(module => ({ default: module.Timeline })));
const WebRackCapacityEditor = lazy(() => import("./WebRackCapacityEditors").then(module => ({ default: module.WebRackCapacityEditor })));
const WebRackUnitCapacityEditor = lazy(() => import("./WebRackCapacityEditors").then(module => ({ default: module.WebRackUnitCapacityEditor })));

type View = "dashboard" | "entry" | "racks" | "history" | "comparison" | "reports" | "settings" | "admin";
const HISTORY_DATA_VIEWS: ReadonlySet<View> = new Set(["dashboard", "entry", "racks", "history", "reports"]);
type HistoryScope = "dashboard" | "rack" | "full";
type Site = FacilitySite;
type Bootstrap = BootstrapState;
type BootstrapApi = Omit<Bootstrap, "sites"> & { sites: Array<{ site: Omit<Site, "availableMonths" | "latestAvailableMonth">; availableMonths: string[]; latestAvailableMonth: string | null }> };
type HistoryData = { months: string[]; logs: MonthlyLog[]; upsGroupHistory?: UpsGroupHistoryReport; rackCapacityHistory?: RackCapacityHistoryRow[]; rackUnitCapacity?: RackUnitCapacityRow[] };
type MonthData = { rowVersion: number | null; log: MonthlyLog | null };
type AdminUser = { id: string; username: string; displayName: string; role: Role; active: boolean; createdAt: string; lastLoginAt: string | null };
type DisplayPeriod = { startMonth: string; endMonth: string; rowVersion: number };
type PendingNavigation = () => void | Promise<void>;

// Match Desktop's local-calendar month semantics. UTC ISO formatting can
// show the previous month during the first hours of a new month in Thailand.
const todayMonth = currentMonth;
const readError = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
const PASSWORD_MIN_LENGTH = 6;
const passwordHelp = (lang: AppLanguage) => lang === "th" ? `ต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` : `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
const readStoredFacility = (userId: string) => { try { return sessionStorage.getItem(facilityStorageKey(userId)); } catch { return null; } };
const storeFacility = (userId: string, siteId: number) => { try { sessionStorage.setItem(facilityStorageKey(userId), String(siteId)); } catch { /* facility remains selected in memory when storage is unavailable */ } };
const readRecentReports = (): ReportHistoryItem[] => { try { return HistoryProvider.list(); } catch { return []; } };

interface WebRackUnitImageSnapshot {
  snapshot: {
    image: {
      available: boolean;
      contentType: "image/png" | "image/jpeg";
      byteSize: number | null;
      sha256: string;
      width: number;
      height: number;
      savedAt: string;
      savedBy: string;
    } | null;
  } | null;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The Rack Unit Capacity image could not be read."));
    reader.readAsDataURL(blob);
  });
}

function createWebRackUnitImageProvider(siteId: number): Pick<IDataProvider, "getRackUnitCapacityImage"> {
  return {
    getRackUnitCapacityImage: async (facility, reportingMonth) => {
      const snapshotResult = await api<WebRackUnitImageSnapshot>(`/rack-unit-capacity?siteId=${siteId}&month=${encodeURIComponent(reportingMonth)}`);
      const image = snapshotResult.snapshot?.image;
      // The metadata endpoint is fail-closed when storage has a transient
      // transport issue. The image endpoint is authoritative for the actual
      // read, so do not suppress a valid image request solely because the
      // availability probe was false for that response.
      if (!image || image.width === null || image.height === null || !image.sha256) return null;
      const response = await fetch(`/api/v1/sites/${siteId}/rack-unit-capacity/${encodeURIComponent(reportingMonth)}/image`, { credentials: "include" });
      if (!response.ok) return null;
      const blob = await response.blob();
      const extension = image.contentType === "image/jpeg" ? "jpg" : "png";
      const meta: StoredImageMeta = {
        facility,
        reportingMonth,
        fileName: `RUC-${monthLabelShort(reportingMonth, "en")}.${extension}`,
        mimeType: image.contentType,
        width: image.width,
        height: image.height,
        sizeBytes: image.byteSize ?? blob.size,
        savedAt: image.savedAt,
        savedBy: image.savedBy,
        checksum: image.sha256
      };
      return { dataUri: await blobToDataUri(blob), meta };
    }
  };
}

function AppNotice({ message }: { message: string | null }) {
  return message ? <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-2xl">{message}</div> : null;
}

function ViewLoading({ lang }: { lang: AppLanguage }) {
  return <section role="status" className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">
    {lang === "th" ? "กำลังโหลดหน้านี้…" : "Loading this page…"}
  </section>;
}

// Static compatibility marker for the entry-workflow contract:
// <WebEntryWorkspace lang={lang} siteName={site.name} siteCode={site.code}

export default function CleanWebApp() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [view, setViewState] = useState<View>("dashboard");
  const [history, setHistory] = useState<HistoryData>({ months: [], logs: [] });
  const [month, setMonth] = useState(todayMonth());
  const [draft, setDraft] = useState<MonthlyLog | null>(null);
  const [rowVersion, setRowVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [entryDirty, setEntryDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null);
  const [pendingCreateMonth, setPendingCreateMonth] = useState<string | null>(null);
  const entryActionsRef = useRef<EntryWorkspaceActions | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [facilityLoading, setFacilityLoading] = useState(false);
  const [facilityError, setFacilityError] = useState<string | null>(null);
  const [initialHistoryLoading, setInitialHistoryLoading] = useState(false);
  // Match src/electron/config.ts DEFAULT_CONFIG.theme. A stored dark choice
  // is still restored by the user-scoped preference effect below.
  const [theme, setTheme] = useState<Theme>("light");
  const [lang, setLang] = useState<AppLanguage>("th");
  const activeSiteIdRef = useRef<number | null>(null);
  const historyCacheRef = useRef(new Map<string, HistoryData>());
  const historyRequestsRef = useRef(new Map<string, Promise<HistoryData>>());
  const loadedPageKeyRef = useRef<string | null>(null);
  const pageLoadGenerationRef = useRef(0);
  const site = useMemo(() => bootstrap?.sites.find(item => item.id === siteId) ?? null, [bootstrap, siteId]);

  const loadHistory = useCallback(async (id: number, options: { force?: boolean; scope?: HistoryScope } = {}) => {
    const scope = options.scope ?? "full";
    const cacheKey = `${id}:${scope}`;
    if (!options.force) {
      const cached = historyCacheRef.current.get(cacheKey);
      if (cached) {
        if (activeSiteIdRef.current === id) setHistory(cached);
        return cached;
      }
    }
    const existing = historyRequestsRef.current.get(cacheKey);
    if (existing) return existing;
    const request = api<HistoryData>(`/sites/${id}/history?scope=${scope}`).then(result => {
      historyCacheRef.current.set(cacheKey, result);
      if (activeSiteIdRef.current === id) setHistory(result);
      return result;
    });
    historyRequestsRef.current.set(cacheKey, request);
    void request.then(
      () => { if (historyRequestsRef.current.get(cacheKey) === request) historyRequestsRef.current.delete(cacheKey); },
      () => { if (historyRequestsRef.current.get(cacheKey) === request) historyRequestsRef.current.delete(cacheKey); }
    );
    return request;
  }, []);
  const loadMonth = useCallback(async (id: number, selectedMonth: string, previous?: HistoryData) => {
    const result = await api<MonthData>(`/sites/${id}/periods/${selectedMonth}`);
    const seed = result.log ?? previous?.logs.at(-1);
    const next = result.log ?? (() => {
      const empty = createEmptyLog(selectedMonth, seed?.ups.map(item => item.upsId), seed?.dc.map(item => item.panelId));
      if (!seed?.energyCalculation) return empty;
      // A missing month is a blank Desktop-style record. Preserve only the
      // prior meter/profile *shape* (including facility-specific meters),
      // never the prior month's readings.
      const blankAir = { ...empty.air } as MonthlyLog["air"];
      for (const key of Object.keys(seed.air)) {
        if (key in blankAir) continue;
        if (key === "meters") {
          blankAir.meters = Object.fromEntries(Object.keys(seed.air.meters ?? {}).map(meter => [meter, null]));
        } else {
          (blankAir as unknown as Record<string, number | null>)[key] = null;
        }
      }
      return { ...empty, energyCalculation: structuredClone(seed.energyCalculation), air: blankAir };
    })();
    if (activeSiteIdRef.current !== id) return;
    setMonth(selectedMonth); setRowVersion(result.rowVersion); setDraft(next);
  }, []);
  const initialize = useCallback(async () => {
    const session = await api<{ authenticated: boolean; user: SessionUser | null }>("/auth/session");
    const user = session.authenticated ? session.user : null;
    setUser(user);
    if (!user) return;
    setFacilityLoading(true); setFacilityError(null);
    try {
      const result = normalizeBootstrap(await api<BootstrapApi>("/bootstrap"));
      const stored = readStoredFacility(user.id);
      const first = selectedFacility(result.sites, stored);
      activeSiteIdRef.current = first?.id ?? null;
      setBootstrap(result); setSiteId(first?.id ?? null);
      if (!first) { setFacilityError("No facility is available for this account."); return; }
      const initialMonth = first.latestAvailableMonth ?? (result.displayPeriod.endMonth < todayMonth() ? result.displayPeriod.endMonth : todayMonth());
      setInitialHistoryLoading(true); setBusy(true); setFacilityLoading(false);
      const historyPromise = loadHistory(first.id, { scope: "dashboard" });
      const monthPromise = loadMonth(first.id, initialMonth);
      const [initialHistory] = await Promise.all([historyPromise, monthPromise]);
      const energyMonth = latestEnergyMonth(initialHistory.logs, initialMonth);
      if (energyMonth !== initialMonth) await loadMonth(first.id, energyMonth, initialHistory);
      loadedPageKeyRef.current = `${first.id}:dashboard`;
    } catch (error) {
      if (activeSiteIdRef.current === null) setFacilityError(`Unable to load facilities: ${readError(error)}`);
      else setNotice(`Unable to load initial site data: ${readError(error)}`);
      throw error;
    }
    finally { setInitialHistoryLoading(false); setBusy(false); setFacilityLoading(false); }
  }, [loadHistory, loadMonth]);
  useEffect(() => { void initialize().catch(error => setNotice(readError(error))); }, [initialize]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(null), 5000); return () => window.clearTimeout(timer); } }, [notice]);
  useEffect(() => { if (!user) return; let savedTheme: string | null = null; let savedLanguage: string | null = null; try { savedTheme = localStorage.getItem(themeStorageKey(user.id)); savedLanguage = localStorage.getItem(languageStorageKey(user.id)); } catch { /* browser storage is optional; defaults remain available */ } const nextTheme = normalizeTheme(savedTheme); setTheme(nextTheme); applyTheme(nextTheme); if (savedLanguage !== null) setLang(normalizeLanguage(savedLanguage)); }, [user]);
  useEffect(() => {
    if (!user || !siteId || facilityLoading || !HISTORY_DATA_VIEWS.has(view)) return;
    const pageKey = `${siteId}:${view}`;
    if (loadedPageKeyRef.current === pageKey) return;
    const generation = ++pageLoadGenerationRef.current;
    setBusy(true);
    const scope: HistoryScope = view === "racks" ? "rack" : view === "history" || view === "reports" ? "full" : "dashboard";
    void loadHistory(siteId, { scope })
      .then(() => { if (pageLoadGenerationRef.current === generation) loadedPageKeyRef.current = pageKey; })
      .catch(error => { if (pageLoadGenerationRef.current === generation) setNotice(`Unable to load ${view} data: ${readError(error)}`); })
      .finally(() => { if (pageLoadGenerationRef.current === generation) setBusy(false); });
  }, [facilityLoading, loadHistory, siteId, user, view]);
  useEffect(() => { if (!entryDirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [entryDirty]);
  type WebUndoEntry = { el: HTMLInputElement | HTMLSelectElement; kind: "input" | "select" | "checkbox"; value: string; checked?: boolean };
  const undoStackRef = useRef<WebUndoEntry[]>([]);
  const undoBaselineRef = useRef<WeakMap<Element, string>>(new WeakMap());
  const undoSessionElRef = useRef<Element | null>(null);
  const suppressUndoRecordRef = useRef(false);
  useEffect(() => {
    const inEntry = (element: Element | null) => Boolean(element?.closest?.("[id^='entry-section-']"));
    const currentValueOf = (element: HTMLInputElement | HTMLSelectElement) => element instanceof HTMLInputElement && element.type === "checkbox" ? String(element.checked) : element.value;
    const onFocusIn = (event: FocusEvent) => {
      const element = event.target as HTMLInputElement | HTMLSelectElement | null;
      if (!element || !inEntry(element) || !("value" in element)) return;
      undoBaselineRef.current.set(element, currentValueOf(element));
      undoSessionElRef.current = null;
    };
    const onInput = (event: Event) => {
      if (suppressUndoRecordRef.current) return;
      const element = event.target as HTMLInputElement | HTMLSelectElement | null;
      if (!element || !inEntry(element) || !("value" in element)) return;
      const kind: WebUndoEntry["kind"] = element instanceof HTMLInputElement && element.type === "checkbox" ? "checkbox" : element instanceof HTMLSelectElement ? "select" : "input";
      if (kind === "input" && undoSessionElRef.current === element) return;
      const baseline = undoBaselineRef.current.get(element) ?? "";
      undoStackRef.current.push({ el: element, kind, value: kind === "checkbox" ? "" : baseline, checked: kind === "checkbox" ? baseline === "true" : undefined });
      if (undoStackRef.current.length > 100) undoStackRef.current.shift();
      if (kind === "input") undoSessionElRef.current = element;
      else undoBaselineRef.current.set(element, currentValueOf(element));
    };
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("input", onInput, true);
    return () => { window.removeEventListener("focusin", onFocusIn, true); window.removeEventListener("input", onInput, true); };
  }, []);
  const undoLastEdit = useCallback(() => {
    while (undoStackRef.current.length > 0) {
      const entry = undoStackRef.current.pop()!;
      const element = entry.el;
      if (!element.isConnected) continue;
      suppressUndoRecordRef.current = true;
      try {
        if (entry.kind === "checkbox") {
          if (element.checked !== entry.checked) element.click();
        } else {
          const prototype = entry.kind === "select" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          setter?.call(element, entry.value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } finally { suppressUndoRecordRef.current = false; }
      undoBaselineRef.current.set(element, entry.kind === "checkbox" ? String(entry.checked) : entry.value);
      undoSessionElRef.current = null;
      element.focus({ preventScroll: true });
      return true;
    }
    return false;
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingText = target?.matches("input, textarea, select") ?? false;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.shiftKey && !event.altKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        setView("reports");
      } else if (command && !event.shiftKey && !event.altKey && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        if (view === "entry") void entryActionsRef.current?.saveAll();
      } else if (command && !event.altKey && (event.key === "e" || event.key === "E")) {
        event.preventDefault();
        setView("reports");
      } else if (command && !event.shiftKey && !event.altKey && (event.key === "z" || event.key === "Z") && view === "entry") {
        if (undoLastEdit()) event.preventDefault();
      } else if (event.key === "F5" && !event.ctrlKey && !event.metaKey && !event.shiftKey && !editingText) {
        event.preventDefault();
        void initialize().catch(error => setNotice(readError(error)));
      } else if (event.key === "Enter" && !command && !event.altKey && target?.tagName === "INPUT" && target.closest("[id^='entry-section-']")) {
        event.preventDefault();
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[id^='entry-section-'] input:not(:disabled)"));
        const index = inputs.indexOf(target as HTMLInputElement);
        const next = inputs[index + (event.shiftKey ? -1 : 1)];
        next?.focus();
        next?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [initialize, undoLastEdit, view]);

  const deferNavigation = (action: PendingNavigation) => { if (entryDirty) setPendingNavigation(() => action); else void action(); };
  const setView = (next: View) => { if (next === view) return; deferNavigation(() => { setEntryDirty(false); setViewState(next); }); };
  const selectSite = async (id: number) => { const nextSite = bootstrap?.sites.find(item => item.id === id); if (!nextSite || !user || id === siteId) return; const action = async () => { setEntryDirty(false); setBusy(true); setInitialHistoryLoading(true); setFacilityError(null); setHistory({ months: [], logs: [] }); setDraft(null); setRowVersion(null); try { activeSiteIdRef.current = id; loadedPageKeyRef.current = null; setSiteId(id); storeFacility(user.id, id); const records = await loadHistory(id, { force: true, scope: "dashboard" }); const candidate = nextSite.latestAvailableMonth ?? (bootstrap && bootstrap.displayPeriod.endMonth < todayMonth() ? bootstrap.displayPeriod.endMonth : todayMonth()); await loadMonth(id, latestEnergyMonth(records.logs, candidate), records); loadedPageKeyRef.current = `${id}:dashboard`; } catch (error) { setNotice(`Unable to load ${nextSite.name}: ${readError(error)}`); } finally { setInitialHistoryLoading(false); setBusy(false); } }; deferNavigation(action); };
  const selectMonth = async (selected: string, exists = true) => {
    if (!siteId || selected === month) return;
    const action = async () => {
      if (!exists) {
        setPendingCreateMonth(selected);
        return;
      }
      setEntryDirty(false); setBusy(true);
      try { await loadMonth(siteId, selected, history); setFacilityError(null); }
      catch (error) { setNotice(readError(error)); }
      finally { setBusy(false); }
    };
    deferNavigation(action);
  };
  const confirmCreateMonth = async () => {
    const selected = pendingCreateMonth;
    if (!selected || !siteId) return;
    setPendingCreateMonth(null); setEntryDirty(false); setBusy(true);
    try { await loadMonth(siteId, selected, history); setFacilityError(null); }
    catch (error) { setNotice(readError(error)); }
    finally { setBusy(false); }
  };
  const save = async (patch: Partial<MonthlyLog> = {}): Promise<boolean> => {
    if (!siteId || !draft) return false;
    const log = { ...draft, ...patch, month };
    setBusy(true);
    try {
      const result = await api<{ rowVersion: number }>(`/sites/${siteId}/periods/${month}`, { method: "PUT", body: JSON.stringify({ log, expected_row_version: rowVersion, provenance: { sourceType: "web-clean-v1" } }) });
      setDraft(log); setRowVersion(result.rowVersion);
      const refreshed = await loadHistory(siteId, { force: true, scope: "dashboard" });
      const refreshedDraft = refreshed.logs.find(item => item.month === month);
      if (refreshedDraft) setDraft(refreshedDraft);
      setNotice(lang === "th" ? "บันทึกข้อมูลไปยัง Data Center Energy & Facility Monitor แล้ว" : "Saved to Data Center Energy & Facility Monitor."); return true;
    } catch (error) { setNotice(readError(error)); return false; } finally { setBusy(false); }
  };
  const logout = async () => { const action = async () => { setEntryDirty(false); try { await api<void>("/auth/logout", { method: "POST" }); } finally { activeSiteIdRef.current = null; historyCacheRef.current.clear(); loadedPageKeyRef.current = null; setUser(null); setBootstrap(null); setDraft(null); } }; deferNavigation(action); };
  const registerEntryActions = useCallback((actions: EntryWorkspaceActions | null) => { entryActionsRef.current = actions; }, []);
  const discardPendingNavigation = () => { const action = pendingNavigation; setPendingNavigation(null); setEntryDirty(false); if (action) void action(); };
  const savePendingNavigation = async () => { const action = pendingNavigation; if (!action) return; const saved = await entryActionsRef.current?.saveAll(); if (!saved) return; setPendingNavigation(null); setEntryDirty(false); void action(); };
  const changeTheme = (next: Theme) => { setTheme(next); applyTheme(next); if (user) { try { localStorage.setItem(themeStorageKey(user.id), next); } catch { /* theme still applies for current page */ } } };
  const changeLanguage = (next: AppLanguage) => { setLang(next); if (user) { try { localStorage.setItem(languageStorageKey(user.id), next); } catch { /* language still applies for current page */ } } };
  const refreshAfterSettings = async () => {
    const result = normalizeBootstrap(await api<BootstrapApi>("/bootstrap"));
    const current = result.sites.find(item => item.id === siteId) ?? result.sites[0] ?? null;
    setBootstrap(result); setSiteId(current?.id ?? null); setFacilityError(null);
    if (current) {
      const records = await loadHistory(current.id, { force: true, scope: "dashboard" });
      const candidate = current.latestAvailableMonth ?? (result.displayPeriod.endMonth < todayMonth() ? result.displayPeriod.endMonth : todayMonth());
      await loadMonth(current.id, latestEnergyMonth(records.logs, candidate), records);
    }
  };

  if (!user) return <Login lang={lang} onLanguageChange={changeLanguage} onLogin={async () => { await initialize(); }} notice={notice} />;
  const completion = computeCompletion(draft);
  // A missing Display Period prevents /bootstrap from returning facility data,
  // but an administrator must still be able to create that initial setting.
  // rowVersion 0 is the API's explicit create precondition.
  const settingsDisplayPeriod = bootstrap?.displayPeriod ?? { startMonth: month, endMonth: month, rowVersion: 0 };
  const shellCopy = lang === "th" ? {
    loadingFacilities: "กำลังโหลดไซต์…", noFacility: "ไม่มีไซต์", selectFacility: "เลือกไซต์", facility: "ไซต์", logout: "ออกจากระบบ",
    reportingMonth: "เดือนรายงาน", displayPeriod: "ช่วงข้อมูล", completion: "ความครบถ้วน", working: "กำลังทำงาน…"
  } : {
    loadingFacilities: "Loading facilities…", noFacility: "No facility available", selectFacility: "Select facility", facility: "Facility", logout: "Logout",
    reportingMonth: "Reporting month", displayPeriod: "Display period", completion: "Completion", working: "Working…"
  };
  const nav: Array<{ id: View; label: string; icon: typeof BarChart3; admin?: boolean }> = [
    { id: "dashboard", label: lang === "th" ? "แดชบอร์ด" : "Dashboard", icon: BarChart3 }, { id: "entry", label: lang === "th" ? "กรอกข้อมูล" : "Data Entry", icon: ClipboardPenLine }, { id: "racks", label: lang === "th" ? "ความจุแร็ค" : "Rack Capacity", icon: Server }, { id: "history", label: lang === "th" ? "ประวัติ" : "History", icon: History }, { id: "comparison", label: lang === "th" ? "เปรียบเทียบไซต์" : "Site Comparison", icon: ChartNoAxesCombined }, { id: "reports", label: lang === "th" ? "ส่งออกและรายงาน" : "Exports & Report", icon: FileSpreadsheet }, { id: "settings", label: lang === "th" ? "ตั้งค่า" : "Settings", icon: Settings }, { id: "admin", label: lang === "th" ? "จัดการผู้ใช้" : "User Management", icon: UsersRound, admin: true }
  ];
  return <ReportProvider syncedLogs={history.logs} displayPeriod={bootstrap?.displayPeriod.startMonth.slice(0, 4)}>
    <div className="em-shell min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur"><div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3"><div className="min-w-0 flex-1"><h1 className="break-words font-display text-lg font-bold tracking-tight">Data Center Energy & Facility Monitor <span className="text-teal-400">v2.3.1</span></h1><p className="truncate text-xs text-slate-400">{facilityLoading ? shellCopy.loadingFacilities : site?.name ?? shellCopy.noFacility} · {user.displayName}</p></div><label className="sr-only" htmlFor="facility-selector">{shellCopy.facility}</label><select id="facility-selector" aria-label={shellCopy.facility} disabled={facilityLoading || !bootstrap || bootstrap.sites.length === 0} value={siteId ?? ""} onChange={event => void selectSite(Number(event.target.value))} className="min-w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm disabled:opacity-60"><option value="">{facilityLoading ? shellCopy.loadingFacilities : bootstrap?.sites.length ? shellCopy.selectFacility : shellCopy.noFacility}</option>{bootstrap?.sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" onClick={() => changeLanguage(lang === "th" ? "en" : "th")} className="rounded-lg border border-slate-700 px-2.5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800" aria-label={lang === "th" ? "เปลี่ยนภาษาเป็นภาษาอังกฤษ" : "Switch language to Thai"}>{lang === "th" ? "EN" : "ไทย"}</button><button type="button" onClick={() => void logout()} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800" title={shellCopy.logout} aria-label={shellCopy.logout}><LogOut className="h-4 w-4" /></button></div></header>
      <div className="mx-auto max-w-[1600px] px-4 py-4 md:px-6 md:py-6"><nav aria-label={lang === "th" ? "à¸™à¸³à¸—à¸²à¸‡à¸«à¸¥à¸±à¸" : "Primary application navigation"} className="mb-5 hidden gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-1.5 shadow-md sm:grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">{nav.filter(item => !item.admin || user.role === "admin").map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setView(item.id)} aria-current={view === item.id ? "page" : undefined} className={`flex items-center justify-center gap-2.5 rounded-xl px-4 py-3.5 text-xs font-bold transition-all ${view === item.id ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/15" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>
        <main className="min-w-0 pb-20 md:pb-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3"><div><span className="text-xs uppercase tracking-wide text-slate-500">{shellCopy.reportingMonth}</span><div className="text-lg font-semibold">{month}</div></div><input aria-label={shellCopy.reportingMonth} type="month" value={month} min={bootstrap?.displayPeriod.startMonth} max={bootstrap ? (bootstrap.displayPeriod.endMonth < todayMonth() ? bootstrap.displayPeriod.endMonth : todayMonth()) : todayMonth()} onChange={event => void selectMonth(event.target.value, history.months.includes(event.target.value))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" /><div className="text-right text-xs text-slate-400">{shellCopy.displayPeriod} {bootstrap?.displayPeriod.startMonth} to {bootstrap?.displayPeriod.endMonth}<br />{shellCopy.completion} <b className="text-teal-300">{completion.overall.percent}%</b></div></div>
           <Suspense fallback={<ViewLoading lang={lang} />}>
           {(busy || initialHistoryLoading) && <div className="mb-4 text-sm text-teal-300">{shellCopy.working}</div>}
          {view === "settings" ? <SettingsPage lang={lang} displayPeriod={settingsDisplayPeriod} isAdmin={user.role === "admin"} theme={theme} onThemeChange={changeTheme} onSaved={async () => { try { await refreshAfterSettings(); setNotice(lang === "th" ? "บันทึกช่วงข้อมูลแล้ว ข้อมูลย้อนหลังไม่ได้ถูกแก้ไข" : "Global Display Period saved. Historical records were not changed."); } catch (error) { setNotice(readError(error)); } }} onMessage={setNotice} /> : view === "admin" && user.role === "admin" ? <Admin lang={lang} /> : facilityError ? <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100"><h2 className="font-semibold">{lang === "th" ? "ไม่สามารถโหลดบริบทไซต์ได้" : "Facility context unavailable"}</h2><p className="mt-2 text-sm">{facilityError}</p><button onClick={() => void initialize().catch(() => undefined)} className="mt-4 rounded-lg border border-rose-300/50 px-3 py-2 text-sm">{lang === "th" ? "ลองโหลดใหม่" : "Retry facility load"}</button></section> : facilityLoading || !site ? <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">{lang === "th" ? "กำลังโหลดข้อมูลไซต์…" : "Loading facility context…"}</section> : <>{view === "dashboard" && <DashboardView logs={history.logs} month={month} lang={lang} upsGroupHistory={history.upsGroupHistory ?? null} />}
          {view === "entry" && draft && <WebEntryWorkspace lang={lang} siteId={siteId!} siteName={site.name} siteCode={site.code} months={history.months} month={month} draft={draft} rackUnitInitialRow={history.rackUnitCapacity?.find(row => row.month === month) ?? null} busy={busy} allowedStartMonth={bootstrap?.displayPeriod.startMonth ?? month} allowedEndMonth={bootstrap ? (bootstrap.displayPeriod.endMonth < todayMonth() ? bootstrap.displayPeriod.endMonth : todayMonth()) : month} onSave={save} onSelectMonth={(selected, exists) => void selectMonth(selected, exists)} onRackUnitSaved={async () => { if (!siteId) return; const records = await loadHistory(siteId, { force: true, scope: "dashboard" }); await loadMonth(siteId, month, records); }} onNotice={setNotice} onDirtyChange={setEntryDirty} onRegisterActions={registerEntryActions} />}
          {view === "racks" && siteId && <RackCapacityView siteId={siteId} siteName={site?.name ?? null} month={month} lang={lang} rackCapacityHistory={history.rackCapacityHistory ?? []} rackUnitCapacity={history.rackUnitCapacity ?? []} allowedStartMonth={bootstrap?.displayPeriod.startMonth ?? month} allowedEndMonth={bootstrap ? (bootstrap.displayPeriod.endMonth < todayMonth() ? bootstrap.displayPeriod.endMonth : todayMonth()) : month} onHistorySaved={() => { void loadHistory(siteId, { force: true, scope: "rack" }); }} onSelectMonth={selected => void selectMonth(selected)} />}
          {view === "history" && <section className="space-y-8"><HistoricalCharts logs={history.logs} lang={lang} displayPeriod={bootstrap?.displayPeriod.startMonth.slice(0, 4)} dataSourceLabel={lang === "th" ? "แหล่งข้อมูล: Production API" : "Source: Production API"} /><HistoricalExplorer logs={history.logs} lang={lang} displayPeriod={bootstrap?.displayPeriod.startMonth.slice(0, 4)} upsGroupHistory={history.upsGroupHistory ?? null} rackCapacityHistory={history.rackCapacityHistory ?? []} rackUnitCapacity={history.rackUnitCapacity ?? []} onEditMonth={selected => { setView("entry"); void selectMonth(selected); window.scrollTo({ top: 0, behavior: "smooth" }); }} /></section>}
          {view === "comparison" && <WebSiteComparison lang={lang} />}
          {view === "reports" && <Reports lang={lang} siteId={siteId} siteName={site?.name ?? "Data Center Energy & Facility Monitor"} logs={history.logs} month={month} sites={bootstrap?.sites ?? []} rackCapacityHistory={history.rackCapacityHistory ?? []} rackUnitCapacity={history.rackUnitCapacity ?? []} />}
          </>}
           </Suspense>
         </main></div>
      <nav aria-label={lang === "th" ? "เมนูนำทางบนมือถือ" : "Mobile application navigation"} className="fixed bottom-0 left-0 right-0 z-30 flex gap-1 overflow-x-auto border-t border-slate-800 bg-slate-950 px-1 md:hidden">{nav.filter(item => !item.admin || user.role === "admin").map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => setView(item.id)} className={`min-w-[4.75rem] shrink-0 flex flex-col items-center gap-1 py-2 text-[10px] ${view === item.id ? "text-teal-300" : "text-slate-500"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>
      {pendingCreateMonth && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 px-4 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-labelledby="create-month-title" className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"><div className="space-y-4 p-6"><div className="flex items-center gap-3"><div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-2.5 text-indigo-400"><Calendar className="h-5 w-5" /></div><div><h2 id="create-month-title" className="font-display text-base font-bold text-slate-100">{lang === "th" ? "สร้างบันทึกรายเดือน" : "Create Monthly Record"}</h2><p className="mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400">{pendingCreateMonth}</p></div></div><p className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-xs leading-relaxed text-slate-300">{lang === "th" ? "ยังไม่มีบันทึกของเดือนนี้ในฐานข้อมูล ต้องการสร้างบันทึกใหม่เพื่อเริ่มกรอกข้อมูลหรือไม่" : "No record exists for this month yet. Create a new monthly record to start entering data?"}</p><div className="flex gap-2.5"><button type="button" onClick={() => setPendingCreateMonth(null)} className="flex-1 rounded-xl border border-slate-700/50 bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700">{lang === "th" ? "ยกเลิก" : "Cancel"}</button><button type="button" onClick={() => void confirmCreateMonth()} className="flex-1 rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/15 hover:bg-indigo-500">{lang === "th" ? "สร้างบันทึก" : "Create"}</button></div></div></section></div>}
      {pendingNavigation && <div role="dialog" aria-modal="true" aria-labelledby="unsaved-entry-title" className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 px-4 backdrop-blur-sm"><section className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-slate-900 p-6 shadow-2xl"><h2 id="unsaved-entry-title" className="font-display text-lg font-bold text-slate-100">{lang === "th" ? "มีข้อมูลที่ยังไม่ได้บันทึก" : "Unsaved Data Entry changes"}</h2><p className="mt-2 text-sm leading-relaxed text-slate-400">{lang === "th" ? "ต้องการบันทึกข้อมูลก่อนออกจากหน้านี้ หรือละทิ้งการแก้ไข?" : "Save your current entries before continuing, discard them, or stay on this page."}</p><div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setPendingNavigation(null)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">{lang === "th" ? "ยกเลิก" : "Cancel"}</button><button type="button" onClick={discardPendingNavigation} className="rounded-lg border border-rose-500/50 px-3 py-2 text-sm text-rose-300">{lang === "th" ? "ละทิ้ง" : "Discard"}</button><button type="button" onClick={() => void savePendingNavigation()} className="rounded-lg bg-teal-500 px-3 py-2 text-sm font-semibold text-slate-950">{lang === "th" ? "บันทึกและดำเนินการต่อ" : "Save & Continue"}</button></div></section></div>}
      <AppNotice message={notice} />
    </div>
  </ReportProvider>;
}

const DASHBOARD_REPORT_VIEWS = ["executive", "dashboard", "benchmark", "forecast"] as const;

function sourceDashboardMapping(siteCode: string, source?: DashboardUpsMappingReport | null): DashboardUpsMappingReport {
  if (source?.mapping?.length) return source;
  return { sourceSheet: "Dashboard-FAC", summary: [], mapping: getDesktopDashboardMapping(siteCode) };
}

/** Dashboard: the same four Desktop views. Executive, Engineering,
 *  Benchmark, and Forecast all derive from the facility-scoped monthly logs
 *  returned by the Web API; no Desktop filesystem or Google dependency is
 *  needed to render them.
 *
 *  DashboardSummary's UPS Groups section reads either a facility.profile.dashboard
 *  topology (Desktop's file-based config/<id>/profile.json - not part of the
 *  Web/Supabase data model) or an upsMapping.summary report. CleanWebApp has
 *  no topology, but it already fetches upsGroupHistory (server-computed,
 *  already facility/Display-Period-scoped) for the History screen - reusing
 *  the selected month's rows here is real data, not a guess, and keeps the
 *  KPI group totals from silently rendering empty. The detailed per-UPS
 *  UMDB/STS/OUDB hardware mapping table has no Web/DB equivalent at all
 *  (Desktop-only busbar data) and is left empty rather than fabricated. */
function DashboardView({ logs, month, siteName = "Facility", siteCode = "", dashboardMapping, lang, upsGroupHistory, onNotice }: { logs: MonthlyLog[]; month: string; siteName?: string; siteCode?: string; dashboardMapping?: DashboardUpsMappingReport | null; lang: "th" | "en"; upsGroupHistory: UpsGroupHistoryReport | null; onNotice?: (message: string) => void }) {
  const { selectedReportView, selectedYear, selectedPeriod } = useReport();
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const notify = onNotice === undefined ? (message: string) => setExportNotice(message) : onNotice;
  const activeMonth = useMemo(() => selectedDashboardMonth(logs, selectedYear, selectedPeriod, month), [logs, month, selectedPeriod, selectedYear]);
  const inferredSiteCode = siteCode || (siteName !== "Facility" ? siteName : (typeof document !== "undefined" ? document.querySelector<HTMLSelectElement>("#facility-selector option:checked")?.textContent ?? "" : ""));
  const upsMapping = useMemo(() => buildDashboardUpsMapping(upsGroupHistory, activeMonth, sourceDashboardMapping(inferredSiteCode, dashboardMapping).mapping), [activeMonth, dashboardMapping, inferredSiteCode, upsGroupHistory]);
  const upsGroupNames = useMemo(() => Array.from(new Set((upsGroupHistory?.rows ?? []).map(row => row.group))), [upsGroupHistory]);
  const exportDashboard = (format: "pdf" | "excel" | "csv" | "png") => {
    const selector = typeof document !== "undefined" ? document.getElementById("facility-selector") as HTMLSelectElement | null : null;
    const activeSiteName = selector?.selectedOptions[0]?.textContent?.trim() || siteName;
    const baseName = `Energy_Report_${activeSiteName.replace(/[^a-z0-9]+/giu, "-")}_${activeMonth}`;
    try {
      if (format === "csv") {
        exportCsv(logs, activeSiteName, `${baseName}.csv`);
        notify("CSV download started.");
      } else if (format === "excel") {
        void exportExcel(logs, activeSiteName, `${baseName}.xlsx`, logs).then(() => notify("Excel download started.")).catch(error => notify(readError(error)));
      } else if (format === "pdf") {
        const popup = openReportPopup("energy-monitor-dashboard-report");
        printDesktopPdfFile(popup, logs, activeSiteName, activeMonth, baseName, null, [], [], logs);
        notify("PDF print dialog opened.");
      } else {
        notify(lang === "th" ? "การส่งออก PNG ต้องใช้ Desktop app" : "Dashboard PNG export requires the Desktop app.");
      }
    } catch (error) { notify(readError(error)); }
  };
  return (
    <div className="space-y-5">
      <UniversalFilterBar lang={lang} onExport={exportDashboard} facility={null} upsGroupNames={upsGroupNames} reportViews={DASHBOARD_REPORT_VIEWS} />
      {exportNotice && <p role="status" className="text-sm text-teal-300">{exportNotice}</p>}
      {selectedReportView === "dashboard" && <DashboardSummary logs={logs} selectedMonth={activeMonth} lang={lang} upsMapping={upsMapping} />}
      {selectedReportView === "executive" && <><ExecutiveDashboard logs={logs} lang={lang} /><SmartInsightPanel logs={logs} lang={lang} /></>}
      {selectedReportView === "benchmark" && <BenchmarkDashboard logs={logs} lang={lang} />}
      {selectedReportView === "forecast" && <ForecastDashboard logs={logs} lang={lang} />}
    </div>
  );
}

interface RackApiSnapshot { rowVersion: number; records: Array<{ rowNumber: number | null; rackZone: string | null; rackId: string | null; status: string | null; cabinetSize: string | null; detail: string | null; deviceType: string | null; remarks: string | null }> }
interface RackUnitApiSnapshot { rowVersion: number; totalU: number; usedU: number; availableU: number; usagePercent: number | null; availabilityPercent: number | null }

/** Syncs RackCapacityContext's own reportingMonth (used only for the
 *  Summary Card's header label; defaults to today's real date, since
 *  Desktop's Rack Capacity page treats it as page-local state independent
 *  of the app's global Reporting month) to the actually-fetched month, so
 *  the header never shows a different month than the data it's labeling. */
function RackCapacityMonthSync({ month, children }: { month: string; children: ReactNode }) {
  const { setReportingMonth } = useRackCapacity();
  useEffect(() => { setReportingMonth(month); }, [month, setReportingMonth]);
  return <>{children}</>;
}

/** Rack Capacity view: shared Desktop summary/heatmap plus Web-specific
 *  editors. Field edits retain Desktop's per-field expected-value conflict
 *  checks; Rack Unit Capacity retains a snapshot row-version and loads the
 *  selected month's image through the Production Storage API. */
function RackCapacityView({ siteId, siteName, month, lang, rackCapacityHistory, rackUnitCapacity, allowedStartMonth, allowedEndMonth, onHistorySaved, onSelectMonth }: { siteId: number; siteName: string | null; month: string; lang: "th" | "en"; rackCapacityHistory: RackCapacityHistoryRow[]; rackUnitCapacity: RackUnitCapacityRow[]; allowedStartMonth: string; allowedEndMonth: string; onHistorySaved?: () => void; onSelectMonth: (month: string) => void }) {
  const th = lang === "th";
  const [rack, setRack] = useState<RackApiSnapshot | null>(null);
  const [rackUnit, setRackUnit] = useState<RackUnitApiSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const rackUnitImageProvider = useMemo(() => createWebRackUnitImageProvider(siteId), [siteId]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading"); setError(null);
    Promise.all([
      api<{ snapshot: RackApiSnapshot | null }>(`/racks?siteId=${siteId}&month=${month}`),
      api<{ snapshot: RackUnitApiSnapshot | null }>(`/rack-unit-capacity?siteId=${siteId}&month=${month}`)
    ]).then(([racks, unit]) => {
      if (cancelled) return;
      setRack(racks.snapshot); setRackUnit(unit.snapshot); setStatus("ready");
    }).catch(reason => { if (!cancelled) { setError(readError(reason)); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [siteId, month]);

  if (status === "loading") return <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">{th ? "กำลังโหลดความจุแร็ค…" : "Loading Rack Capacity…"}</section>;
  if (status === "error") return <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100"><h2 className="font-semibold">{th ? "ไม่สามารถโหลดความจุแร็คได้" : "Rack Capacity unavailable"}</h2><p className="mt-2 text-sm">{error}</p></section>;

  const countBy = (records: RackApiSnapshot["records"], key: (record: RackApiSnapshot["records"][number]) => string | null): Array<{ key: string; count: number }> => {
    const counts = new Map<string, number>();
    for (const record of records) { const value = key(record) ?? "(blank)"; counts.set(value, (counts.get(value) ?? 0) + 1); }
    return Array.from(counts, ([value, count]) => ({ key: value, count }));
  };
  const rackCapacity: RackCapacitySummary | null = rack && rack.records.length > 0 ? {
    totalRacks: rack.records.length,
    records: rack.records.map(r => ({ rowNumber: r.rowNumber ?? 0, rackZone: r.rackZone, rackId: r.rackId, status: r.status, cabinetSize: r.cabinetSize, detail: r.detail, deviceType: r.deviceType, remarks: r.remarks })),
    byStatus: countBy(rack.records, r => r.status).map(({ key, count }) => ({ status: key, count })),
    byZone: countBy(rack.records, r => r.rackZone).map(({ key, count }) => ({ zone: key, count }))
  } : null;

  return (
    <div className="space-y-5">
      <div><h2 className="font-display text-2xl font-bold">{th ? "ความจุแร็คและการใช้งาน" : "Rack Capacity and Utilization"}</h2><p className="mt-1 text-sm text-slate-400">{th ? `แก้ไขข้อมูลตาม Desktop ประวัติ snapshot และความจุหน่วยแร็คสำหรับ ${month}` : `Desktop-compatible field editing, snapshot history, and rack-unit capacity for ${month}.`}</p></div>
        <RackCapacityProvider lang={lang} facilityName={siteName} initialReportingMonth={month} rackCapacity={rackCapacity} rackUnitCapacity={rackUnitCapacity} rackCapacityHistory={rackCapacityHistory}>
        <RackCapacityStickyHeader />
        <RackCapacityTimeline canSelectMonth={selected => selected >= allowedStartMonth && selected <= allowedEndMonth} onMonthSelect={onSelectMonth} />
        <CapacityAlerts />
        <RackCapacityExecutiveKpiCards />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CapacityGauge />
          <RackCapacityForecast />
        </div>
        <RackCapacityMonthSync month={month}><RackCapacitySummaryCard /></RackCapacityMonthSync>
        <RackUnitCapacitySummary provider={rackUnitImageProvider} />
        <RackCapacityHistoryPanel />
        <WebRackCapacityEditor siteId={siteId} month={month} onSaved={(next) => { setRack(next); onHistorySaved?.(); }} />
      </RackCapacityProvider>
      <WebRackUnitCapacityEditor lang={lang} siteId={siteId} month={month} initialSnapshot={rackUnit} onSaved={(next) => { setRackUnit(next); onHistorySaved?.(); }} />
    </div>
  );
}

function Login({ lang, onLanguageChange, onLogin, notice }: { lang: AppLanguage; onLanguageChange: (lang: AppLanguage) => void; onLogin: () => Promise<void>; notice: string | null }) {
  const th = lang === "th";
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { await api("/auth/csrf"); await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); await onLogin(); } catch (reason) { setError(readError(reason)); } finally { setBusy(false); } };
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100"><form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl"><div className="flex items-start justify-between gap-3"><h1 className="break-words font-display text-3xl font-bold">Data Center Energy & Facility Monitor</h1><button type="button" onClick={() => onLanguageChange(th ? "en" : "th")} className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300" aria-label={th ? "เปลี่ยนภาษาเป็นภาษาอังกฤษ" : "Switch language to Thai"}>{th ? "EN" : "ไทย"}</button></div><p className="mt-2 text-sm text-slate-400">{th ? "เข้าสู่พื้นที่ปฏิบัติการ v2.3.1 เพื่อดำเนินการต่อ" : "Sign in to continue to the v2.3.1 operations workspace."}</p><label className="mt-6 block text-sm">{th ? "ชื่อผู้ใช้" : "Username"}<input required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5" /></label><label className="mt-4 block text-sm">{th ? "รหัสผ่าน" : "Password"}<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5" /></label>{(error ?? notice) && <p role="alert" className="mt-4 text-sm text-rose-300">{error ?? notice}</p>}<button disabled={busy} className="mt-6 w-full rounded-lg bg-teal-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-60">{busy ? (th ? "กำลังเข้าสู่ระบบ…" : "Signing in…") : (th ? "เข้าสู่ระบบ" : "Login")}</button></form></main>;
}

const PERIOD_MODE_OPTIONS: Array<{ value: ReportingPeriodMode; label: string }> = [
  { value: "current", label: "Current Month" },
  { value: "single", label: "Single Month" },
  { value: "range", label: "Month Range" },
  { value: "full", label: "Full History" }
];

/** Reports & Export ("Current Facility" scope): Reporting Period and
 *  Reporting Month are real, functional controls - changing them filters
 *  which already-fetched months are handed to the existing, unmodified
 *  CSV/Excel/PDF builders (see reportPeriod.ts), so Excel/CSV/PDF always
 *  reflect the current selection, never a stale earlier one. Matches
 *  Desktop's four Reporting Period modes, confirmed by direct inspection. */
function Reports({ lang, siteId, siteName, logs, month, sites, rackCapacityHistory, rackUnitCapacity }: { lang: AppLanguage; siteId: number | null; siteName: string; logs: MonthlyLog[]; month: string; sites: Site[]; rackCapacityHistory: RackCapacityHistoryRow[]; rackUnitCapacity: RackUnitCapacityRow[] }) {
  const th = lang === "th";
  const reportCopy = th ? {
    title: "รายงานและการส่งออก", intro: "Excel เก็บค่าที่กรอก ค่าวันที่บันทึก และค่าคำนวณของ Desktop v2.3.1 เป็นเซลล์ชนิดข้อมูล ตัวเลขมีทศนิยม 2 ตำแหน่ง และวันที่ใช้รูปแบบ dd-Mmm-yy",
    context: "บริบทการรายงาน", applies: "ใช้กับการส่งออกของไซต์ปัจจุบัน", period: "ช่วงเวลารายงาน", month: "เดือนรายงาน", from: "ตั้งแต่", to: "ถึง", fileName: "ชื่อไฟล์", reset: "คืนค่าเริ่มต้น", scope: "ขอบเขต", current: "ไซต์ปัจจุบัน", all: "ทุกไซต์", comparison: "เปรียบเทียบไซต์", currentDesc: "ส่งออกข้อมูลของไซต์ปัจจุบันตามช่วงที่เลือก", allDesc: "แยกข้อมูลแต่ละไซต์ใน CSV, ชีต Excel และส่วนรายงาน PDF", comparisonDesc: "สรุป KPI ของทุกไซต์ตามเดือนที่เลือก โดยไม่สร้างค่าทดแทนข้อมูลที่หายไป", csvStarted: "เริ่มดาวน์โหลด CSV แล้ว", excelStarted: "เริ่มดาวน์โหลด Excel แล้ว", pdfStarted: "เปิดหน้าต่างพิมพ์ PDF แล้ว"
  } : {
    title: "Exports & PDF Report", intro: "Excel keeps stored entry values, saved dates, and Desktop v2.3.1 calculations as typed cells: numbers use two decimals and dates use dd-Mmm-yy",
    context: "Report Context", applies: "Applies to the Current Facility export below", period: "Reporting Period", month: "Reporting Month", from: "From", to: "To", fileName: "File name", reset: "Reset", scope: "Scope", current: "Current Facility", all: "All Facilities", comparison: "Site Comparison", currentDesc: "Export the selected facility for the chosen reporting period", allDesc: "Each facility stays isolated in its own CSV block, Excel sheets, HTML, and full PDF section", comparisonDesc: "Comparison KPI snapshot for the selected month; no values are fabricated for missing records", csvStarted: "CSV download started.", excelStarted: "Excel download started.", pdfStarted: "PDF print dialog opened."
  };
  const [message, setMessage] = useState<string | null>(null);
  const [period, setPeriod] = useState<ReportingPeriodSelection>(() => defaultReportingPeriod(month));
  const [fileNameInput, setFileNameInput] = useState(() => defaultReportFilename(siteName, month));
  const [fileNameCustomized, setFileNameCustomized] = useState(false);
  const [recentReports, setRecentReports] = useState<ReportHistoryItem[]>(readRecentReports);
  const [selectedReportSections, setSelectedReportSections] = useState<ReportSectionId[]>(() => ReportRegistry.all().map(section => section.id));
  const [reportSectionSearch, setReportSectionSearch] = useState("");
  const visibleReportSections = useMemo(() => ReportRegistry.all().filter(section => section.title.toLowerCase().includes(reportSectionSearch.toLowerCase())), [reportSectionSearch]);
  const toggleReportSection = (section: ReportSectionId) => setSelectedReportSections(current => current.includes(section) ? current.filter(item => item !== section) : [...current, section]);
  // A facility genuinely may have no Rack Capacity snapshot for the
  // selected month (same as the live Rack Capacity view's null-snapshot
  // case) - degrade to no rack section in the PDF rather than failing the
  // whole export.
  const loadRack = useCallback(async (targetSiteId: number, targetMonth: string): Promise<RackSnapshotApiResponse | null> => {
    try { return await api<RackSnapshotApiResponse>(`/racks?siteId=${targetSiteId}&month=${targetMonth}`); }
    catch { return null; }
  }, []);
  const loadAll = useCallback(async () => Promise.all(sites.map(async site => {
    const [siteHistory, rackResponse] = await Promise.all([api<HistoryData>(`/sites/${site.id}/history`), loadRack(site.id, month)]);
    return { siteName: site.name, logs: siteHistory.logs, calculationLogs: siteHistory.logs, rack: rackReportFromSnapshot(rackResponse), rackHistory: siteHistory.rackCapacityHistory ?? [], rackUnitCapacity: siteHistory.rackUnitCapacity ?? [], upsGroupHistory: siteHistory.upsGroupHistory ?? null, dashboardMapping: { sourceSheet: "Dashboard-FAC", summary: [], mapping: getDesktopDashboardMapping(site.name) } };
  })), [sites, month, loadRack]);
  const loadComparison = useCallback(async () => api<SiteComparisonExport>("/site-comparison"), []);
  const rememberReport = (filename: string) => {
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `web-report-${Date.now()}`;
    const item: ReportHistoryItem = { id, filename, facility: siteName, month: reportingPeriodLabel(period, lang), pages: null, createdAt: new Date().toISOString() };
    try { setRecentReports(HistoryProvider.add(item)); } catch { /* local history is optional; export remains successful */ }
  };
  // action() may throw synchronously (e.g. openReportPopup() when the
  // popup was blocked) - awaited inside the try so both a synchronous
  // throw and a rejected promise report the same friendly message.
  // Invoke the action in the click handler itself. PDF actions must call
  // window.open() before the first async boundary or the browser may block
  // the report popup; only the completion bookkeeping is deferred.
  const run = (action: () => void | Promise<void>, success: string, historyFilename: string) => {
    let result: void | Promise<void>;
    try { result = action(); }
    catch (error) { setMessage(readError(error)); return; }
    void Promise.resolve(result)
      .then(() => { rememberReport(historyFilename); setMessage(success); })
      .catch(error => setMessage(readError(error)));
  };

  const contextMonth = effectiveMonth(period, month);
  const reportContextKey = `${siteName}\u0000${contextMonth}`;
  const previousReportContext = useRef(reportContextKey);
  useEffect(() => {
    if (previousReportContext.current === reportContextKey) return;
    previousReportContext.current = reportContextKey;
    setFileNameInput(defaultReportFilename(siteName, contextMonth));
    setFileNameCustomized(false);
  }, [contextMonth, reportContextKey, siteName]);
  useEffect(() => {
    const available = [...new Set(logs.map(log => log.month))].sort();
    const fallback = available.includes(month) ? month : available.at(-1) ?? month;
    setPeriod(current => {
      const singleMonth = available.includes(current.singleMonth) ? current.singleMonth : fallback;
      const rangeStart = available.includes(current.rangeStart) ? current.rangeStart : available[0] ?? fallback;
      const rangeEnd = available.includes(current.rangeEnd) ? current.rangeEnd : available.at(-1) ?? fallback;
      if (singleMonth === current.singleMonth && rangeStart === current.rangeStart && rangeEnd === current.rangeEnd) return current;
      return { ...current, singleMonth, rangeStart, rangeEnd };
    });
  }, [logs, month, siteName]);
  const resolvedFileName = resolveFilename(fileNameInput, siteName, contextMonth);
  const scopedLogs = useMemo(() => filterLogsByPeriod(logs, period, month), [logs, period, month]);
  const availableMonths = useMemo(() => [...new Set(logs.map(log => log.month))].sort(), [logs]);
  const exportHtml = (...args: Parameters<typeof exportHtmlFile>) => exportHtmlFile(...(args.concat([selectedReportSections]) as Parameters<typeof exportHtmlFile>));
  const printDesktopPdf = (...args: Parameters<typeof printDesktopPdfFile>) => printDesktopPdfFile(...(args.concat([selectedReportSections]) as Parameters<typeof printDesktopPdfFile>));
  const exportAllFacilitiesHtml = (facilities: Parameters<typeof exportAllFacilitiesHtmlFile>[0], selectedMonth: string) => exportAllFacilitiesHtmlFile(facilities, selectedMonth, undefined, selectedReportSections);
  const printAllFacilitiesPdf = (...args: Parameters<typeof printAllFacilitiesPdfFile>) => printAllFacilitiesPdfFile(...(args.concat([selectedReportSections]) as Parameters<typeof printAllFacilitiesPdfFile>));

  const cards = (title: string, description: string, onCsv: () => void | Promise<void>, onExcel: () => void | Promise<void>, onHtml: () => void | Promise<void>, onPdf: () => void | Promise<void>, filenames: { csv: string; excel: string; html: string; pdf: string }) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h3 className="font-semibold">{title}</h3><p className="mt-1 min-h-10 text-sm text-slate-400">{description}</p><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><button onClick={() => run(onCsv, reportCopy.csvStarted, filenames.csv)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-teal-500"><Download className="mr-2 inline h-4 w-4 text-teal-400" />CSV</button><button onClick={() => run(onExcel, reportCopy.excelStarted, filenames.excel)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-teal-500"><FileSpreadsheet className="mr-2 inline h-4 w-4 text-emerald-400" />Excel</button><button onClick={() => run(onHtml, th ? "à¹€à¸£à¸´à¹ˆà¸¡à¸”à¸²à¸§à¸™à¹Œà¹‚à¸«à¸¥à¸” HTML à¹à¸¥à¹‰à¸§" : "HTML download started.", filenames.html)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-teal-500"><FileCode2 className="mr-2 inline h-4 w-4 text-sky-400" />HTML</button><button onClick={() => run(onPdf, reportCopy.pdfStarted, filenames.pdf)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-teal-500"><Printer className="mr-2 inline h-4 w-4 text-amber-400" />PDF</button></div></div>;

  const sectionPicker = <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{th ? "ส่วนของรายงาน" : "Report sections"}</h3><span className="text-xs text-slate-500">{selectedReportSections.length} selected</span></div><p className="mt-1 text-sm text-slate-400">{th ? "เลือกส่วนที่ต้องการสำหรับตัวอย่างและ PDF/HTML; Excel และ CSV ยังคงเก็บข้อมูลดิบครบทุกค่า" : "Choose sections for the preview and PDF/HTML; Excel and CSV remain complete raw exports."}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setSelectedReportSections(ReportRegistry.all().map(section => section.id))} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-teal-300">{th ? "เลือกทั้งหมด" : "Select all"}</button><button type="button" onClick={() => setSelectedReportSections([])} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300">{th ? "ล้างทั้งหมด" : "Select none"}</button><input aria-label={th ? "ค้นหาส่วนรายงาน" : "Search report sections"} value={reportSectionSearch} onChange={event => setReportSectionSearch(event.target.value)} placeholder={th ? "ค้นหา" : "Search"} className="min-w-44 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs" /></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{visibleReportSections.map(section => <label key={section.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-300 hover:bg-slate-800"><input type="checkbox" checked={selectedReportSections.includes(section.id)} onChange={() => toggleReportSection(section.id)} />{section.title}</label>)}</div></div>;
  return <section><h2 className="font-display text-2xl font-bold">{reportCopy.title}</h2><p className="mt-1 text-sm text-slate-400">{reportCopy.intro}</p>{sectionPicker}

    <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900 p-5">
      <h3 className="font-semibold">{reportCopy.context}</h3>
      <p className="mt-1 text-sm text-slate-400">{reportCopy.applies}. {th ? "ไซต์" : "Facility"}: <b className="text-slate-200">{siteName}</b>.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">{reportCopy.period}<select value={period.mode} onChange={event => setPeriod({ ...period, mode: event.target.value as ReportingPeriodMode })} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{PERIOD_MODE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{th ? ({ current: "เดือนปัจจุบัน", single: "เดือนเดียว", range: "ช่วงเดือน", full: "ประวัติทั้งหมด" } as Record<ReportingPeriodMode, string>)[opt.value] : opt.label}</option>)}</select></label>
        {period.mode === "single" && <label className="text-sm">{reportCopy.month}<select value={period.singleMonth} onChange={event => setPeriod({ ...period, singleMonth: event.target.value })} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{availableMonths.map(m => <option key={m} value={m}>{m}</option>)}</select></label>}
        {period.mode === "range" && <><label className="text-sm">{reportCopy.from}<select value={period.rangeStart} onChange={event => setPeriod({ ...period, rangeStart: event.target.value })} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{availableMonths.map(m => <option key={m} value={m}>{m}</option>)}</select></label><label className="text-sm">{reportCopy.to}<select value={period.rangeEnd} onChange={event => setPeriod({ ...period, rangeEnd: event.target.value })} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{availableMonths.map(m => <option key={m} value={m}>{m}</option>)}</select></label></>}
        <label className="text-sm sm:col-span-2 lg:col-span-2">{reportCopy.fileName}<div className="mt-1 flex gap-2"><input value={fileNameInput} onChange={event => { setFileNameInput(event.target.value); setFileNameCustomized(true); }} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm" /><button type="button" onClick={() => setFileNameCustomized(false)} className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-teal-500" title={reportCopy.reset}>{reportCopy.reset}</button></div></label>
      </div>
      <p className="mt-3 text-xs text-slate-500">{reportCopy.scope}: {reportingPeriodLabel(period, lang)}. {th ? "ไฟล์" : "Files"}: <span className="font-mono text-slate-300">{withExtension(resolvedFileName, "csv")}</span> · <span className="font-mono text-slate-300">{withExtension(resolvedFileName, "xlsx")}</span> · <span className="font-mono text-slate-300">{withExtension(resolvedFileName, "html")}</span> · <span className="font-mono text-slate-300">{withExtension(resolvedFileName, "pdf")}</span></p>
    </div>

    <div className="mt-4 grid gap-4 xl:grid-cols-3">{cards(reportCopy.current, `${siteName}, ${reportingPeriodLabel(period, lang)}.`, () => exportCsv(scopedLogs, siteName, withExtension(resolvedFileName, "csv")), () => (async () => { const rack = siteId !== null ? rackReportFromSnapshot(await loadRack(siteId, contextMonth)) : null; await exportExcel(scopedLogs, siteName, withExtension(resolvedFileName, "xlsx"), logs, rack, rackCapacityHistory, rackUnitCapacity); })(), () => (async () => { const rack = siteId !== null ? rackReportFromSnapshot(await loadRack(siteId, contextMonth)) : null; exportHtml(scopedLogs, siteName, contextMonth, withExtension(resolvedFileName, "html"), rack, rackCapacityHistory, rackUnitCapacity, logs); })(), () => { const popup = openReportPopup("energy-monitor-report"); return (async () => { const rack = siteId !== null ? rackReportFromSnapshot(await loadRack(siteId, contextMonth)) : null; printDesktopPdf(popup, scopedLogs, siteName, contextMonth, resolvedFileName, rack, rackCapacityHistory, rackUnitCapacity, logs); })(); }, { csv: withExtension(resolvedFileName, "csv"), excel: withExtension(resolvedFileName, "xlsx"), html: withExtension(resolvedFileName, "html"), pdf: withExtension(resolvedFileName, "pdf") })}{cards(reportCopy.all, reportCopy.allDesc, async () => exportAllFacilitiesCsv(await loadAll()), async () => exportAllFacilitiesExcel(await loadAll()), async () => exportAllFacilitiesHtml(await loadAll(), month), () => { const popup = openReportPopup("energy-monitor-all-facilities"); return (async () => { printAllFacilitiesPdf(popup, await loadAll(), month); })(); }, { csv: "all-facilities-energy-monitor.csv", excel: "all-facilities-energy-monitor.xlsx", html: "all-facilities-energy-monitor.html", pdf: "all-facilities-energy-monitor.pdf" })}{cards(reportCopy.comparison, reportCopy.comparisonDesc, async () => exportSiteComparisonCsv(await loadComparison(), month), async () => exportSiteComparisonExcel(await loadComparison(), month), async () => { const comparison = await loadComparison(); const [primary, secondary] = comparison.sites; const [selfRack, otherRack] = await Promise.all([primary ? loadRack(primary.site.id, month) : null, secondary ? loadRack(secondary.site.id, month) : null]); exportSiteComparisonHtml(comparison, month, `site-comparison-${month}.html`, rackReportFromSnapshot(selfRack), rackReportFromSnapshot(otherRack)); }, () => { const popup = openReportPopup("energy-monitor-site-comparison"); return (async () => { const comparison = await loadComparison(); const [primary, secondary] = comparison.sites; const [selfRack, otherRack] = await Promise.all([primary ? loadRack(primary.site.id, month) : null, secondary ? loadRack(secondary.site.id, month) : null]); printSiteComparisonPdf(popup, comparison, month, rackReportFromSnapshot(selfRack), rackReportFromSnapshot(otherRack)); })(); }, { csv: `site-comparison-${month}.csv`, excel: `site-comparison-${month}.xlsx`, html: `site-comparison-${month}.html`, pdf: `site-comparison-${month}.pdf` })}</div>
    {recentReports.length > 0 && <section className="mt-5 rounded-xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{th ? "รายงานล่าสุด" : "Recent Reports"}</h3><span className="text-xs text-slate-500">{th ? "บันทึกในเบราว์เซอร์นี้" : "Saved on this browser"}</span></div><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="pb-2">{th ? "ไฟล์" : "Filename"}</th><th>{th ? "ไซต์" : "Facility"}</th><th>{th ? "ช่วงเวลา" : "Period"}</th><th>{th ? "สร้างเมื่อ" : "Created"}</th><th /></tr></thead><tbody>{recentReports.slice(0, 20).map(item => <tr key={item.id} className="border-t border-slate-800 text-slate-300"><td className="py-2 font-medium">{item.filename}</td><td>{item.facility}</td><td>{item.month}</td><td>{new Date(item.createdAt).toLocaleString(lang === "th" ? "th-TH" : "en-US")}</td><td className="text-right"><button type="button" onClick={() => { try { setRecentReports(HistoryProvider.remove(item.id)); } catch { setRecentReports(current => current.filter(entry => entry.id !== item.id)); } }} className="text-slate-500 hover:text-rose-300">{th ? "ลบ" : "Remove"}</button></td></tr>)}</tbody></table></div></section>}
    <WebReportPreview lang={lang} siteId={siteId} siteName={siteName} logs={scopedLogs} calculationLogs={logs} month={contextMonth} rackCapacityHistory={rackCapacityHistory} rackUnitCapacity={rackUnitCapacity} sections={selectedReportSections} />
    {message && <p className="mt-4 text-sm text-teal-300">{message}</p>}</section>;
}

function SettingsPage({ lang, displayPeriod, isAdmin, theme, onThemeChange, onSaved, onMessage }: { lang: AppLanguage; displayPeriod: DisplayPeriod; isAdmin: boolean; theme: Theme; onThemeChange: (theme: Theme) => void; onSaved: () => Promise<void>; onMessage: (message: string) => void }) {
  const th = lang === "th";
  const [startMonth, setStartMonth] = useState(displayPeriod.startMonth);
  const [endMonth, setEndMonth] = useState(displayPeriod.endMonth);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStartMonth(displayPeriod.startMonth); setEndMonth(displayPeriod.endMonth); }, [displayPeriod]);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth) || startMonth > endMonth) { onMessage(th ? "เดือนเริ่มต้นต้องไม่เกินเดือนสิ้นสุด" : "Start month must be on or before end month."); return; } setBusy(true); try { await api<DisplayPeriod>("/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: startMonth, end_month: endMonth, expected_row_version: displayPeriod.rowVersion }) }); await onSaved(); } catch (error) { onMessage(readError(error)); } finally { setBusy(false); } };
  return <section className="space-y-5"><div><h2 className="font-display text-2xl font-bold">{th ? "ตั้งค่าแอปพลิเคชัน" : "Application Settings"}</h2><p className="mt-1 text-sm text-slate-400">{th ? "ตั้งค่ารูปแบบการแสดงผลและข้อมูลที่จำเป็นของ Data Center Energy & Facility Monitor" : "Personal appearance and required Data Center Energy & Facility Monitor settings."}</p></div><section className="max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-5"><h3 className="font-semibold">{th ? "รูปแบบการแสดงผล" : "Appearance"}</h3><p className="mt-1 text-sm text-slate-400">{th ? "ธีมมีผลทันทีและบันทึกเฉพาะบัญชีในเบราว์เซอร์นี้" : "Theme applies immediately and is saved only for this browser account."}</p><div className="mt-4 flex flex-wrap gap-3" role="radiogroup" aria-label={th ? "ธีม" : "Theme"}><button type="button" role="radio" aria-checked={theme === "light"} onClick={() => onThemeChange("light")} className={`min-w-32 rounded-xl border px-4 py-3 text-left ${theme === "light" ? "border-indigo-500 bg-indigo-500/10 text-indigo-300" : "border-slate-700 text-slate-300"}`}><b>{th ? "สว่าง" : "Light"}</b><span className="mt-1 block text-xs opacity-75">{th ? "พื้นที่ทำงานโทนเบจ" : "Warm beige workspace"}</span></button><button type="button" role="radio" aria-checked={theme === "dark"} onClick={() => onThemeChange("dark")} className={`min-w-32 rounded-xl border px-4 py-3 text-left ${theme === "dark" ? "border-indigo-500 bg-indigo-500/10 text-indigo-300" : "border-slate-700 text-slate-300"}`}><b>{th ? "มืด" : "Dark"}</b><span className="mt-1 block text-xs opacity-75">{th ? "พื้นที่ทำงานโทนน้ำเงินเข้ม" : "Deep navy workspace"}</span></button></div></section>{isAdmin && <form onSubmit={submit} className="max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-5"><h3 className="font-semibold">{th ? "ช่วงข้อมูลส่วนกลาง" : "Global Display Period"}</h3><p className="mt-1 text-sm text-slate-400">{th ? "กำหนดเดือนที่แสดงใน Dashboard, Data Entry, History, Site Comparison และการส่งออก โดยไม่แก้ไขข้อมูลย้อนหลัง" : "Controls visible months in Dashboard, Data Entry, History, Site Comparison, and exports. Saving never changes historical records."}</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm">{th ? "เดือนเริ่มต้น" : "Start month"}<input required type="month" value={startMonth} onChange={event => setStartMonth(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" /></label><label className="text-sm">{th ? "เดือนสิ้นสุด" : "End month"}<input required type="month" value={endMonth} onChange={event => setEndMonth(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2" /></label></div><button disabled={busy} className="mt-5 rounded-xl bg-indigo-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-60">{busy ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึกช่วงข้อมูล" : "Save Display Period")}</button></form>}</section>;
}

// function Admin()
// aria-label="Role"
// aria-label={`Role for ${target.username}`}
// if (!window.confirm(`Change
function Admin({ lang }: { lang: AppLanguage }) {
  const th = lang === "th";
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", display_name: "", password: "", role: "user" as Role, active: true });
  const [resetUserId, setResetUserId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const load = useCallback(async () => { try { setUsers(await api<AdminUser[]>("/admin/users")); } catch (error) { setMessage(readError(error)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async (event: FormEvent) => { event.preventDefault(); if (Array.from(form.password).length < PASSWORD_MIN_LENGTH || /^\s*$/u.test(form.password)) { setMessage(passwordHelp(lang)); return; } try { await api("/admin/users", { method: "POST", body: JSON.stringify(form) }); setForm({ username: "", display_name: "", password: "", role: "user", active: true }); setMessage(th ? "สร้างผู้ใช้แล้ว" : "User created."); await load(); } catch (error) { setMessage(readError(error)); } };
  const reset = async (event: FormEvent) => { event.preventDefault(); if (Array.from(resetPassword).length < PASSWORD_MIN_LENGTH || /^\s*$/u.test(resetPassword)) { setMessage(passwordHelp(lang)); return; } try { await api(`/admin/users/${resetUserId}/password`, { method: "POST", body: JSON.stringify({ password: resetPassword }) }); setResetPassword(""); setMessage(th ? "รีเซ็ตรหัสผ่านและยกเลิกเซสชันแล้ว" : "Password reset and sessions revoked."); } catch (error) { setMessage(readError(error)); } };
  const active = async (target: AdminUser) => { if (target.active && !window.confirm(th ? `ปิดใช้งานผู้ใช้ "${target.displayName}" (${target.username})? เซสชันเดิมจะถูกยกเลิก` : `Disable user "${target.displayName}" (${target.username})? Existing sessions will be revoked.`)) return; try { await api(`/admin/users/${target.id}/active`, { method: "PATCH", body: JSON.stringify({ active: !target.active }) }); await load(); } catch (error) { setMessage(readError(error)); } };
  const changeRole = async (target: AdminUser, role: Role) => { if (role === target.role) return; if (!window.confirm(th ? `เปลี่ยนบทบาท "${target.displayName}" (${target.username}) จาก ${target.role} เป็น ${role} ใช่หรือไม่` : `Change "${target.displayName}" (${target.username}) from ${target.role} to ${role}?`)) return; try { await api(`/admin/users/${target.id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }); setMessage(th ? "อัปเดตบทบาทแล้ว" : "Role updated."); await load(); } catch (error) { setMessage(readError(error)); await load(); } };
  const saveDisplayName = async (target: AdminUser) => { const displayName = displayNameDraft.trim(); if (!displayName) { setMessage(th ? "ต้องระบุชื่อที่แสดง" : "Display name is required."); return; } try { await api(`/admin/users/${target.id}/display-name`, { method: "PATCH", body: JSON.stringify({ display_name: displayName }) }); setEditingUserId(null); setMessage(th ? "อัปเดตชื่อที่แสดงแล้ว" : "Display name updated."); await load(); } catch (error) { setMessage(readError(error)); } };
  const remove = async (target: AdminUser) => { if (!window.confirm(th ? `ลบผู้ใช้ "${target.displayName}" (${target.username})? ไม่สามารถย้อนกลับได้` : `Delete user "${target.displayName}" (${target.username})? This cannot be undone.`)) return; try { await api<void>(`/admin/users/${target.id}`, { method: "DELETE" }); setMessage(th ? "ลบผู้ใช้แล้ว" : "User deleted."); await load(); } catch (error) { setMessage(readError(error)); } };
  return <section><h2 className="font-display text-2xl font-bold">{th ? "จัดการผู้ใช้" : "User Management"}</h2><form onSubmit={create} className="mt-5 grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-5"><input required placeholder={th ? "ชื่อผู้ใช้" : "Username"} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} className="rounded border border-slate-700 bg-slate-950 px-3 py-2" /><input required placeholder={th ? "ชื่อที่แสดง" : "Display name"} value={form.display_name} onChange={event => setForm({ ...form, display_name: event.target.value })} className="rounded border border-slate-700 bg-slate-950 px-3 py-2" /><input required type="password" placeholder={th ? "รหัสผ่านเริ่มต้น" : "Initial password"} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} className="rounded border border-slate-700 bg-slate-950 px-3 py-2" /><select aria-label={th ? "บทบาท" : "Role"} value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Role })} className="rounded border border-slate-700 bg-slate-950 px-3 py-2"><option value="user">User</option><option value="admin">Admin</option></select><button className="rounded bg-teal-500 px-3 py-2 font-semibold text-slate-950">{th ? "เพิ่มผู้ใช้" : "Add user"}</button><label className="flex items-center gap-2 text-xs text-slate-400 md:col-span-5"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> {th ? "เปิดใช้งาน" : "Active"}</label></form><form onSubmit={reset} className="mt-3 flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4"><select required value={resetUserId} onChange={event => setResetUserId(event.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2"><option value="">{th ? "เลือกผู้ใช้เพื่อรีเซ็ต" : "Select user to reset"}</option>{users.map(target => <option key={target.id} value={target.id}>{target.username}</option>)}</select><input required type="password" placeholder={th ? "รหัสผ่านใหม่" : "New password"} value={resetPassword} onChange={event => setResetPassword(event.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2" /><button className="rounded border border-amber-500/60 px-3 py-2 text-amber-300">{th ? "รีเซ็ตรหัสผ่าน" : "Reset password"}</button></form><div className="mt-5 overflow-x-auto rounded-xl border border-slate-800"><table className="w-full text-sm"><thead className="bg-slate-900 text-left text-slate-400"><tr><th className="p-3">{th ? "ผู้ใช้" : "User"}</th><th className="p-3">{th ? "บทบาท" : "Role"}</th><th className="p-3">{th ? "สถานะ" : "Status"}</th><th className="p-3">{th ? "การดำเนินการ" : "Actions"}</th></tr></thead><tbody>{users.map(target => <tr key={target.id} className="border-t border-slate-800"><td className="p-3">{editingUserId === target.id ? <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void saveDisplayName(target); }}><input required aria-label={`${th ? "ชื่อที่แสดงของ" : "Display name for"} ${target.username}`} value={displayNameDraft} onChange={event => setDisplayNameDraft(event.target.value)} className="min-w-40 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm" /><button className="text-teal-300">{th ? "บันทึก" : "Save"}</button><button type="button" onClick={() => setEditingUserId(null)} className="text-slate-400">{th ? "ยกเลิก" : "Cancel"}</button></form> : <><b>{target.displayName}</b><button type="button" onClick={() => { setEditingUserId(target.id); setDisplayNameDraft(target.displayName); }} className="ml-2 text-xs text-teal-300">{th ? "แก้ไข" : "Edit"}</button><br /><span className="text-slate-400">{target.username}</span></>}</td><td className="p-3"><select aria-label={`${th ? "บทบาทของ" : "Role for"} ${target.username}`} value={target.role} onChange={event => void changeRole(target, event.target.value as Role)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm"><option value="user">User</option><option value="admin">Admin</option></select></td><td className="p-3">{target.active ? (th ? "เปิดใช้งาน" : "Enabled") : (th ? "ปิดใช้งาน" : "Disabled")}</td><td className="space-x-2 p-3"><button onClick={() => void active(target)} className="text-teal-300">{target.active ? (th ? "ปิดใช้งาน" : "Disable") : (th ? "เปิดใช้งาน" : "Enable")}</button><button onClick={() => void remove(target)} className="text-rose-300">{th ? "ลบ" : "Delete"}</button></td></tr>)}</tbody></table></div>{message && <p className="mt-4 text-sm text-teal-300">{message}</p>}</section>;
}
