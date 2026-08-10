import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BarChart3, ChartNoAxesCombined, ClipboardPenLine, Download, FileSpreadsheet, History, LogOut, Printer, Settings, UsersRound } from "lucide-react";
import { Line, LineChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ReportProvider } from "../ReportContext";
import DashboardSummary from "../components/DashboardSummary";
import HistoricalExplorer from "../components/HistoricalExplorer";
import UpsTable from "../components/UpsTable";
import AirTable from "../components/AirTable";
import DcTable from "../components/DcTable";
import EnergyCostTable from "../components/EnergyCostTable";
import { createEmptyLog } from "../utils";
import { computeCompletion } from "../utils/completion";
import type { MonthlyLog } from "../types";
import { api, type SessionUser, type Role } from "./api";
import { exportAllFacilitiesCsv, exportAllFacilitiesExcel, exportCsv, exportExcel, exportSiteComparisonCsv, exportSiteComparisonExcel, printAllFacilitiesPdf, printDesktopPdf, printSiteComparisonPdf, type ComparisonMetric, type SiteComparisonExport } from "./exports";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { facilityStorageKey, normalizeBootstrap, selectedFacility, type BootstrapState, type FacilitySite } from "./facilityContext";

type View = "dashboard" | "entry" | "history" | "comparison" | "reports" | "settings" | "admin";
type Site = FacilitySite;
type Bootstrap = BootstrapState;
type BootstrapApi = Omit<Bootstrap, "sites"> & { sites: Array<{ site: Omit<Site, "availableMonths" | "latestAvailableMonth">; availableMonths: string[]; latestAvailableMonth: string | null }> };
type HistoryData = { months: string[]; logs: MonthlyLog[] };
type MonthData = { rowVersion: number | null; log: MonthlyLog | null };
type AdminUser = { id: string; username: string; displayName: string; role: Role; active: boolean; createdAt: string; lastLoginAt: string | null };
type DisplayPeriod = { startMonth: string; endMonth: string; rowVersion: number };

const todayMonth = () => new Date().toISOString().slice(0, 7);
const readError = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
const readStoredFacility = (userId: string) => { try { return sessionStorage.getItem(facilityStorageKey(userId)); } catch { return null; } };
const storeFacility = (userId: string, siteId: number) => { try { sessionStorage.setItem(facilityStorageKey(userId), String(siteId)); } catch { /* facility remains selected in memory when storage is unavailable */ } };

function AppNotice({ message }: { message: string | null }) {
  return message ? <div role="status" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-2xl">{message}</div> : null;
}

export default function CleanWebApp() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [history, setHistory] = useState<HistoryData>({ months: [], logs: [] });
  const [month, setMonth] = useState(todayMonth());
  const [draft, setDraft] = useState<MonthlyLog | null>(null);
  const [rowVersion, setRowVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [facilityLoading, setFacilityLoading] = useState(false);
  const [facilityError, setFacilityError] = useState<string | null>(null);
  const site = useMemo(() => bootstrap?.sites.find(item => item.id === siteId) ?? null, [bootstrap, siteId]);

  const loadHistory = useCallback(async (id: number) => {
    const result = await api<HistoryData>(`/sites/${id}/history`);
    setHistory(result);
    return result;
  }, []);
  const loadMonth = useCallback(async (id: number, selectedMonth: string, previous?: HistoryData) => {
    const result = await api<MonthData>(`/sites/${id}/periods/${selectedMonth}`);
    const seed = result.log ?? previous?.logs.at(-1);
    const next = result.log ?? (() => {
      const empty = createEmptyLog(selectedMonth, seed?.ups.map(item => item.upsId), seed?.dc.map(item => item.panelId));
      return seed?.energyCalculation ? { ...empty, energyCalculation: structuredClone(seed.energyCalculation), air: structuredClone(seed.air) } : empty;
    })();
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
      setBootstrap(result); setSiteId(first?.id ?? null);
      if (!first) { setFacilityError("No facility is available for this account."); return; }
      const records = await loadHistory(first.id);
      await loadMonth(first.id, first.latestAvailableMonth ?? result.displayPeriod.endMonth, records);
    } catch (error) { setFacilityError(`Unable to load facilities: ${readError(error)}`); throw error; }
    finally { setFacilityLoading(false); }
  }, [loadHistory, loadMonth]);
  useEffect(() => { void initialize().catch(error => setNotice(readError(error))); }, [initialize]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(null), 5000); return () => window.clearTimeout(timer); } }, [notice]);

  const selectSite = async (id: number) => { const nextSite = bootstrap?.sites.find(item => item.id === id); if (!nextSite || !user) return; setBusy(true); setFacilityError(null); try { setSiteId(id); storeFacility(user.id, id); const records = await loadHistory(id); await loadMonth(id, nextSite.latestAvailableMonth ?? bootstrap?.displayPeriod.endMonth ?? todayMonth(), records); } catch (error) { setFacilityError(`Unable to load ${nextSite.name}: ${readError(error)}`); } finally { setBusy(false); } };
  const selectMonth = async (selected: string) => { if (!siteId) return; setBusy(true); try { await loadMonth(siteId, selected, history); } catch (error) { setNotice(readError(error)); } finally { setBusy(false); } };
  const save = async (patch: Partial<MonthlyLog> = {}) => {
    if (!siteId || !draft) return;
    const log = { ...draft, ...patch, month };
    setBusy(true);
    try {
      const result = await api<{ rowVersion: number }>(`/sites/${siteId}/periods/${month}`, { method: "PUT", body: JSON.stringify({ log, expected_row_version: rowVersion, provenance: { sourceType: "web-clean-v1" } }) });
      setDraft(log); setRowVersion(result.rowVersion); await loadHistory(siteId); setNotice("Saved to Energy Monitor.");
    } catch (error) { setNotice(readError(error)); } finally { setBusy(false); }
  };
  const logout = async () => { try { await api<void>("/auth/logout", { method: "POST" }); } finally { setUser(null); setBootstrap(null); setDraft(null); } };
  const refreshAfterSettings = async () => {
    const result = normalizeBootstrap(await api<BootstrapApi>("/bootstrap"));
    const current = result.sites.find(item => item.id === siteId) ?? result.sites[0] ?? null;
    setBootstrap(result); setSiteId(current?.id ?? null);
    if (current) {
      const records = await loadHistory(current.id);
      await loadMonth(current.id, current.latestAvailableMonth ?? result.displayPeriod.endMonth, records);
    }
  };

  if (!user) return <Login onLogin={async () => { await initialize(); }} notice={notice} />;
  const completion = computeCompletion(draft);
  const nav: Array<{ id: View; label: string; icon: typeof BarChart3; admin?: boolean }> = [
    { id: "dashboard", label: "Dashboard", icon: BarChart3 }, { id: "entry", label: "Data Entry", icon: ClipboardPenLine }, { id: "history", label: "History", icon: History }, { id: "comparison", label: "Site Comparison", icon: ChartNoAxesCombined }, { id: "reports", label: "Exports & Report", icon: FileSpreadsheet }, { id: "settings", label: "Settings", icon: Settings, admin: true }, { id: "admin", label: "User Management", icon: UsersRound, admin: true }
  ];
  return <ReportProvider syncedLogs={history.logs} displayPeriod={bootstrap?.displayPeriod.startMonth.slice(0, 4)}>
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur"><div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3"><div className="min-w-0 flex-1"><h1 className="font-display text-lg font-bold tracking-tight">Energy Monitor <span className="text-teal-400">v2.3.1</span></h1><p className="truncate text-xs text-slate-400">{facilityLoading ? "Loading facilities…" : site?.name ?? "No facility available"} · {user.displayName}</p></div><label className="sr-only" htmlFor="facility-selector">Selected facility</label><select id="facility-selector" aria-label="Facility" disabled={facilityLoading || !bootstrap || bootstrap.sites.length === 0} value={siteId ?? ""} onChange={event => void selectSite(Number(event.target.value))} className="min-w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm disabled:opacity-60"><option value="">{facilityLoading ? "Loading facilities…" : bootstrap?.sites.length ? "Select facility" : "No facility available"}</option>{bootstrap?.sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={() => void logout()} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800" title="Logout"><LogOut className="h-4 w-4" /></button></div></header>
      <div className="mx-auto flex max-w-[1600px]"><aside className="hidden w-56 shrink-0 border-r border-slate-800 p-3 md:block">{nav.filter(item => !item.admin || user.role === "admin").map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => setView(item.id)} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${view === item.id ? "bg-teal-500/15 text-teal-300" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</aside>
        <main className="min-w-0 flex-1 p-4 md:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3"><div><span className="text-xs uppercase tracking-wide text-slate-500">Reporting month</span><div className="text-lg font-semibold">{month}</div></div><input aria-label="Reporting month" type="month" value={month} min={bootstrap?.displayPeriod.startMonth} max={bootstrap ? (bootstrap.displayPeriod.endMonth < todayMonth() ? bootstrap.displayPeriod.endMonth : todayMonth()) : todayMonth()} onChange={event => void selectMonth(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" /><div className="text-right text-xs text-slate-400">Display period {bootstrap?.displayPeriod.startMonth} to {bootstrap?.displayPeriod.endMonth}<br />Completion <b className="text-teal-300">{completion.overall.percent}%</b></div></div>
          {busy && <div className="mb-4 text-sm text-teal-300">Working…</div>}
          {facilityError ? <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-5 text-rose-100"><h2 className="font-semibold">Facility context unavailable</h2><p className="mt-2 text-sm">{facilityError}</p><button onClick={() => void initialize().catch(() => undefined)} className="mt-4 rounded-lg border border-rose-300/50 px-3 py-2 text-sm">Retry facility load</button></section> : facilityLoading || !site ? <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">Loading facility context…</section> : <>{view === "dashboard" && <DashboardSummary logs={history.logs} selectedMonth={month} lang="en" />}
          {view === "entry" && draft && <section className="space-y-5"><div><h2 className="font-display text-2xl font-bold">Monthly Data Entry</h2><p className="mt-1 text-sm text-slate-400">Enter validated operating readings for {month}; calculations remain Desktop v2.3.1-compatible.</p></div><UpsTable monthStr={month} initialRecords={draft.ups} lastSaved={draft.lastSavedUps} onSave={records => void save({ ups: records })} /><AirTable monthStr={month} initialRecord={draft.air} lastSaved={draft.lastSavedAir} meterFields={draft.energyCalculation?.airFields} onSave={air => void save({ air })} /><DcTable monthStr={month} initialRecords={draft.dc} lastSaved={draft.lastSavedDc} onSave={dc => void save({ dc })} /><EnergyCostTable monthStr={month} initialRecord={draft.energyCost} lastSaved={draft.lastSavedEnergyCost} onSave={energyCost => void save({ energyCost })} /></section>}
          {view === "history" && <HistoricalExplorer logs={history.logs} lang="en" displayPeriod={bootstrap?.displayPeriod.startMonth.slice(0, 4)} onEditMonth={selected => { setView("entry"); void selectMonth(selected); }} />}
          {view === "comparison" && <SiteComparison />}
          {view === "reports" && <Reports siteName={site?.name ?? "energy-monitor"} logs={history.logs} month={month} sites={bootstrap?.sites ?? []} />}
          {view === "settings" && user.role === "admin" && bootstrap && <AdminSettings displayPeriod={bootstrap.displayPeriod} onSaved={async () => { try { await refreshAfterSettings(); setNotice("Global Display Period saved. Historical records were not changed."); } catch (error) { setNotice(readError(error)); } }} onMessage={setNotice} />}
          {view === "admin" && user.role === "admin" && <Admin />}
          </>}
        </main></div>
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-slate-800 bg-slate-950 md:hidden">{nav.filter(item => !item.admin || user.role === "admin").map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => setView(item.id)} className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] ${view === item.id ? "text-teal-300" : "text-slate-500"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>
      <AppNotice message={notice} />
    </div>
  </ReportProvider>;
}

function Login({ onLogin, notice }: { onLogin: () => Promise<void>; notice: string | null }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { await api("/auth/csrf"); await api("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); await onLogin(); } catch (reason) { setError(readError(reason)); } finally { setBusy(false); } };
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4"><form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl"><h1 className="font-display text-3xl font-bold">Energy Monitor</h1><p className="mt-2 text-sm text-slate-400">Sign in to continue to the v2.3.1 operations workspace.</p><label className="mt-6 block text-sm">Username<input required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5" /></label><label className="mt-4 block text-sm">Password<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5" /></label>{(error ?? notice) && <p role="alert" className="mt-4 text-sm text-rose-300">{error ?? notice}</p>}<button disabled={busy} className="mt-6 w-full rounded-lg bg-teal-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-60">{busy ? "Signing in…" : "Login"}</button></form></main>;
}

function Reports({ siteName, logs, month, sites }: { siteName: string; logs: MonthlyLog[]; month: string; sites: Site[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const loadAll = useCallback(async () => Promise.all(sites.map(async site => ({ siteName: site.name, logs: (await api<HistoryData>(`/sites/${site.id}/history`)).logs }))), [sites]);
  const loadComparison = useCallback(async () => api<SiteComparisonExport>("/site-comparison"), []);
  const run = (action: () => void | Promise<void>, success: string) => { void Promise.resolve(action()).then(() => setMessage(success)).catch(error => setMessage(readError(error))); };
  const cards = (title: string, description: string, onCsv: () => void | Promise<void>, onExcel: () => void | Promise<void>, onPdf: () => void | Promise<void>) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h3 className="font-semibold">{title}</h3><p className="mt-1 min-h-10 text-sm text-slate-400">{description}</p><div className="mt-4 grid gap-2 sm:grid-cols-3"><button onClick={() => run(onCsv, "CSV download started.")} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-teal-500"><Download className="mr-2 inline h-4 w-4 text-teal-400" />CSV</button><button onClick={() => run(onExcel, "Excel download started.")} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-teal-500"><FileSpreadsheet className="mr-2 inline h-4 w-4 text-emerald-400" />Excel</button><button onClick={() => run(onPdf, "PDF print dialog opened.")} className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-teal-500"><Printer className="mr-2 inline h-4 w-4 text-amber-400" />PDF</button></div></div>;
  return <section><h2 className="font-display text-2xl font-bold">Exports & PDF Report</h2><p className="mt-1 text-sm text-slate-400">Every export uses stored inputs and Desktop v2.3.1 calculations within Global Display Period.</p><div className="mt-6 grid gap-4 xl:grid-cols-3">{cards("Current Facility", `${siteName} for visible reporting months.`, () => exportCsv(logs, siteName), () => exportExcel(logs, siteName), () => printDesktopPdf(logs, siteName, month))}{cards("All Facilities", "Each facility stays isolated in its own CSV block, Excel sheets, and full PDF section.", async () => exportAllFacilitiesCsv(await loadAll()), async () => exportAllFacilitiesExcel(await loadAll()), async () => printAllFacilitiesPdf(await loadAll(), month))}{cards("Site Comparison", `Comparison KPI snapshot for ${month}; no values are fabricated for missing records.`, async () => exportSiteComparisonCsv(await loadComparison(), month), async () => exportSiteComparisonExcel(await loadComparison(), month), async () => printSiteComparisonPdf(await loadComparison(), month))}</div>{message && <p className="mt-4 text-sm text-teal-300">{message}</p>}</section>;
}

const metric = (value: number | null | undefined, suffix = "") => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${formatNumber2(value)}${suffix}`;

function SiteComparison() {
  const [data, setData] = useState<SiteComparisonExport | null>(null);
  const [referenceMonth, setReferenceMonth] = useState("");
  const [range, setRange] = useState<3 | 6 | 12>(12);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { const result = await api<SiteComparisonExport>("/site-comparison"); setData(result); const common = result.months.filter(month => result.sites.every(site => site.months.some(entry => entry.month === month && entry.metrics))); setReferenceMonth((common.at(-1) ?? result.months.at(-1)) ?? ""); setError(null); } catch (reason) { setError(readError(reason)); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (error) return <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200">{error}</section>;
  if (!data) return <p className="text-sm text-slate-400">Loading Site Comparison…</p>;
  const windowMonths = data.months.filter(month => month <= referenceMonth).slice(-range);
  const chartData = windowMonths.map(month => Object.fromEntries([["month", month], ...data.sites.map(site => [site.site.code, site.months.find(entry => entry.month === month)?.metrics?.buildingEnergy ?? null])]));
  return <section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl font-bold">Site Comparison</h2><p className="mt-1 text-sm text-slate-400">Same period, same formulas, separate facility records.</p></div><div className="flex flex-wrap items-center gap-2"><label className="text-sm">Reference month<select value={referenceMonth} onChange={event => setReferenceMonth(event.target.value)} className="ml-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{data.months.map(month => <option key={month} value={month}>{month}</option>)}</select></label><div className="flex rounded-lg border border-slate-700 p-1">{([3, 6, 12] as const).map(value => <button key={value} onClick={() => setRange(value)} className={`rounded px-2 py-1 text-xs ${range === value ? "bg-teal-500 text-slate-950" : "text-slate-300"}`}>Last {value}</button>)}</div></div></div><div className="overflow-x-auto rounded-xl border border-slate-800"><table className="min-w-[960px] w-full text-sm"><thead className="bg-slate-900 text-left text-slate-400"><tr><th className="p-3">Facility</th><th className="p-3 text-right">Building energy</th><th className="p-3 text-right">Building cost</th><th className="p-3 text-right">Floor energy</th><th className="p-3 text-right">Floor cost</th><th className="p-3 text-right">Average rate</th><th className="p-3 text-right">Floor share</th></tr></thead><tbody>{data.sites.map(site => { const values: ComparisonMetric | null = site.months.find(entry => entry.month === referenceMonth)?.metrics ?? null; return <tr key={site.site.id} className="border-t border-slate-800"><td className="p-3"><b>{site.site.name}</b><br /><span className="text-xs text-slate-500">{referenceMonth}</span></td><td className="p-3 text-right font-mono">{metric(values?.buildingEnergy)} kWh</td><td className="p-3 text-right font-mono">{metric(values?.buildingCost)} THB</td><td className="p-3 text-right font-mono">{metric(values?.floorEnergy)} kWh</td><td className="p-3 text-right font-mono">{metric(values?.floorCost)} THB</td><td className="p-3 text-right font-mono">{metric(values?.avgRate)} THB/kWh</td><td className="p-3 text-right font-mono">{metric(values?.floorShare, "%")}</td></tr>; })}</tbody></table></div><div className="h-80 rounded-xl border border-slate-800 bg-slate-900 p-4"><h3 className="mb-3 font-semibold">Monthly Energy Consumption Trend</h3><ResponsiveContainer width="100%" height="90%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#334155" /><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />{data.sites.map((site, index) => <Line key={site.site.id} type="monotone" dataKey={site.site.code} name={site.site.name} stroke={index % 2 === 0 ? "#e87959" : "#5b8db8"} connectNulls={false} />)}</LineChart></ResponsiveContainer></div></section>;
}

function AdminSettings({ displayPeriod, onSaved, onMessage }: { displayPeriod: DisplayPeriod; onSaved: () => Promise<void>; onMessage: (message: string) => void }) {
  const [startMonth, setStartMonth] = useState(displayPeriod.startMonth);
  const [endMonth, setEndMonth] = useState(displayPeriod.endMonth);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setStartMonth(displayPeriod.startMonth); setEndMonth(displayPeriod.endMonth); }, [displayPeriod]);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth) || startMonth > endMonth) { onMessage("Start month must be on or before end month."); return; } setBusy(true); try { await api<DisplayPeriod>("/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: startMonth, end_month: endMonth, expected_row_version: displayPeriod.rowVersion }) }); await onSaved(); } catch (error) { onMessage(readError(error)); } finally { setBusy(false); } };
  return <section><h2 className="font-display text-2xl font-bold">Application Settings</h2><p className="mt-1 text-sm text-slate-400">Admin-only settings required for Energy Monitor workflow.</p><form onSubmit={submit} className="mt-5 max-w-2xl rounded-xl border border-slate-800 bg-slate-900 p-5"><h3 className="font-semibold">Global Display Period</h3><p className="mt-1 text-sm text-slate-400">Controls visible months in Dashboard, Data Entry, History, Site Comparison, and exports. Saving never changes historical records.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm">Start month<input required type="month" value={startMonth} onChange={event => setStartMonth(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label><label className="text-sm">End month<input required type="month" value={endMonth} onChange={event => setEndMonth(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" /></label></div><button disabled={busy} className="mt-5 rounded-lg bg-teal-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-60">{busy ? "Saving…" : "Save Display Period"}</button></form></section>;
}

function Admin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", display_name: "", password: "", role: "user" as Role });
  const [resetUserId, setResetUserId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const load = useCallback(async () => { try { setUsers(await api<AdminUser[]>("/admin/users")); } catch (error) { setMessage(readError(error)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async (event: FormEvent) => { event.preventDefault(); try { await api("/admin/users", { method: "POST", body: JSON.stringify(form) }); setForm({ username: "", display_name: "", password: "", role: "user" }); setMessage("User created."); await load(); } catch (error) { setMessage(readError(error)); } };
  const reset = async (event: FormEvent) => { event.preventDefault(); try { await api(`/admin/users/${resetUserId}/password`, { method: "POST", body: JSON.stringify({ password: resetPassword }) }); setResetPassword(""); setMessage("Password reset and sessions revoked."); } catch (error) { setMessage(readError(error)); } };
  const active = async (target: AdminUser) => { try { await api(`/admin/users/${target.id}/active`, { method: "PATCH", body: JSON.stringify({ active: !target.active }) }); await load(); } catch (error) { setMessage(readError(error)); } };
  const remove = async (target: AdminUser) => { try { await api<void>(`/admin/users/${target.id}`, { method: "DELETE" }); setMessage("User deleted."); await load(); } catch (error) { setMessage(readError(error)); } };
  return <section><h2 className="font-display text-2xl font-bold">User Management</h2><form onSubmit={create} className="mt-5 grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-4"><input required placeholder="Username" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} className="rounded border border-slate-700 bg-slate-950 px-3 py-2" /><input required placeholder="Display name" value={form.display_name} onChange={event => setForm({ ...form, display_name: event.target.value })} className="rounded border border-slate-700 bg-slate-950 px-3 py-2" /><input required type="password" placeholder="Initial password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} className="rounded border border-slate-700 bg-slate-950 px-3 py-2" /><button className="rounded bg-teal-500 px-3 py-2 font-semibold text-slate-950">Add user</button></form><form onSubmit={reset} className="mt-3 flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4"><select required value={resetUserId} onChange={event => setResetUserId(event.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2"><option value="">Select user to reset</option>{users.map(target => <option key={target.id} value={target.id}>{target.username}</option>)}</select><input required type="password" placeholder="New password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2" /><button className="rounded border border-amber-500/60 px-3 py-2 text-amber-300">Reset password</button></form><div className="mt-5 overflow-x-auto rounded-xl border border-slate-800"><table className="w-full text-sm"><thead className="bg-slate-900 text-left text-slate-400"><tr><th className="p-3">User</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{users.map(target => <tr key={target.id} className="border-t border-slate-800"><td className="p-3"><b>{target.displayName}</b><br /><span className="text-slate-400">{target.username}</span></td><td className="p-3">{target.role}</td><td className="p-3">{target.active ? "Enabled" : "Disabled"}</td><td className="space-x-2 p-3"><button onClick={() => void active(target)} className="text-teal-300">{target.active ? "Disable" : "Enable"}</button><button onClick={() => void remove(target)} className="text-rose-300">Delete</button></td></tr>)}</tbody></table></div>{message && <p className="mt-4 text-sm text-teal-300">{message}</p>}</section>;
}
