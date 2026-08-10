import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BarChart3, ClipboardPenLine, Download, FileSpreadsheet, History, LogOut, Printer, Settings, UsersRound } from "lucide-react";
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
import { exportCsv, exportExcel, printDesktopPdf } from "./exports";

type View = "dashboard" | "entry" | "history" | "reports" | "admin";
type Site = { id: number; code: string; name: string; active: boolean; availableMonths: string[]; latestAvailableMonth: string | null };
type Bootstrap = { displayPeriod: { startMonth: string; endMonth: string }; sites: Site[] };
type HistoryData = { months: string[]; logs: MonthlyLog[] };
type MonthData = { rowVersion: number | null; log: MonthlyLog | null };
type AdminUser = { id: string; username: string; displayName: string; role: Role; active: boolean; createdAt: string; lastLoginAt: string | null };

const todayMonth = () => new Date().toISOString().slice(0, 7);
const readError = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";

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
    const result = await api<Bootstrap>("/bootstrap");
    const first = result.sites[0] ?? null;
    setBootstrap(result); setSiteId(first?.id ?? null);
    if (first) {
      const records = await loadHistory(first.id);
      await loadMonth(first.id, first.latestAvailableMonth ?? todayMonth(), records);
    }
  }, [loadHistory, loadMonth]);
  useEffect(() => { void initialize().catch(error => setNotice(readError(error))); }, [initialize]);
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => setNotice(null), 5000); return () => window.clearTimeout(timer); } }, [notice]);

  const selectSite = async (id: number) => { setBusy(true); try { setSiteId(id); const records = await loadHistory(id); const nextSite = bootstrap?.sites.find(item => item.id === id); await loadMonth(id, nextSite?.latestAvailableMonth ?? todayMonth(), records); } catch (error) { setNotice(readError(error)); } finally { setBusy(false); } };
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

  if (!user) return <Login onLogin={async () => { await initialize(); }} notice={notice} />;
  const completion = computeCompletion(draft);
  const nav: Array<{ id: View; label: string; icon: typeof BarChart3; admin?: boolean }> = [
    { id: "dashboard", label: "Dashboard", icon: BarChart3 }, { id: "entry", label: "Data Entry", icon: ClipboardPenLine }, { id: "history", label: "History", icon: History }, { id: "reports", label: "Exports & Report", icon: FileSpreadsheet }, { id: "admin", label: "User Management", icon: UsersRound, admin: true }
  ];
  return <ReportProvider syncedLogs={history.logs} displayPeriod={bootstrap?.displayPeriod.startMonth.slice(0, 4)}>
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur"><div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3"><div className="min-w-0 flex-1"><h1 className="font-display text-lg font-bold tracking-tight">Energy Monitor <span className="text-teal-400">v2.3.1</span></h1><p className="truncate text-xs text-slate-400">{site?.name ?? "Loading facility…"} · {user.displayName}</p></div><select aria-label="Facility" value={siteId ?? ""} onChange={event => void selectSite(Number(event.target.value))} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm">{bootstrap?.sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button onClick={() => void logout()} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800" title="Logout"><LogOut className="h-4 w-4" /></button></div></header>
      <div className="mx-auto flex max-w-[1600px]"><aside className="hidden w-56 shrink-0 border-r border-slate-800 p-3 md:block">{nav.filter(item => !item.admin || user.role === "admin").map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => setView(item.id)} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${view === item.id ? "bg-teal-500/15 text-teal-300" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</aside>
        <main className="min-w-0 flex-1 p-4 md:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3"><div><span className="text-xs uppercase tracking-wide text-slate-500">Reporting month</span><div className="text-lg font-semibold">{month}</div></div><input aria-label="Reporting month" type="month" value={month} max={todayMonth()} onChange={event => void selectMonth(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" /><div className="text-right text-xs text-slate-400">Completion <b className="text-teal-300">{completion.overall.percent}%</b></div></div>
          {busy && <div className="mb-4 text-sm text-teal-300">Working…</div>}
          {view === "dashboard" && <DashboardSummary logs={history.logs} selectedMonth={month} lang="en" />}
          {view === "entry" && draft && <section className="space-y-5"><div><h2 className="font-display text-2xl font-bold">Monthly Data Entry</h2><p className="mt-1 text-sm text-slate-400">Enter validated operating readings for {month}; calculations remain Desktop v2.3.1-compatible.</p></div><UpsTable monthStr={month} initialRecords={draft.ups} lastSaved={draft.lastSavedUps} onSave={records => void save({ ups: records })} /><AirTable monthStr={month} initialRecord={draft.air} lastSaved={draft.lastSavedAir} meterFields={draft.energyCalculation?.airFields} onSave={air => void save({ air })} /><DcTable monthStr={month} initialRecords={draft.dc} lastSaved={draft.lastSavedDc} onSave={dc => void save({ dc })} /><EnergyCostTable monthStr={month} initialRecord={draft.energyCost} lastSaved={draft.lastSavedEnergyCost} onSave={energyCost => void save({ energyCost })} /></section>}
          {view === "history" && <HistoricalExplorer logs={history.logs} lang="en" displayPeriod={bootstrap?.displayPeriod.startMonth.slice(0, 4)} onEditMonth={selected => { setView("entry"); void selectMonth(selected); }} />}
          {view === "reports" && <Reports siteName={site?.name ?? "energy-monitor"} logs={history.logs} month={month} />}
          {view === "admin" && user.role === "admin" && <Admin />}
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

function Reports({ siteName, logs, month }: { siteName: string; logs: MonthlyLog[]; month: string }) { const [message, setMessage] = useState<string | null>(null); return <section><h2 className="font-display text-2xl font-bold">Exports & PDF Report</h2><p className="mt-1 text-sm text-slate-400">Exports use the same stored inputs and Desktop calculation functions.</p><div className="mt-6 grid gap-4 sm:grid-cols-3"><button onClick={() => { exportCsv(logs, siteName); setMessage("CSV download started."); }} className="rounded-xl border border-slate-700 bg-slate-900 p-5 text-left hover:border-teal-500"><Download className="mb-3 h-5 w-5 text-teal-400" /><b>Export CSV</b><p className="mt-1 text-sm text-slate-400">All operating sections</p></button><button onClick={() => void exportExcel(logs, siteName).then(() => setMessage("Excel download started.")).catch(error => setMessage(readError(error)))} className="rounded-xl border border-slate-700 bg-slate-900 p-5 text-left hover:border-teal-500"><FileSpreadsheet className="mb-3 h-5 w-5 text-emerald-400" /><b>Export Excel</b><p className="mt-1 text-sm text-slate-400">Multi-sheet workbook</p></button><button onClick={() => { try { printDesktopPdf(logs, siteName, month); } catch (error) { setMessage(readError(error)); } }} className="rounded-xl border border-slate-700 bg-slate-900 p-5 text-left hover:border-teal-500"><Printer className="mb-3 h-5 w-5 text-amber-400" /><b>Generate PDF</b><p className="mt-1 text-sm text-slate-400">Desktop report layout</p></button></div>{message && <p className="mt-4 text-sm text-teal-300">{message}</p>}</section>; }

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
