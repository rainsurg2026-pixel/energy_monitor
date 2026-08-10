import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileSpreadsheet, LockKeyhole, LogOut, Pencil, Plus, ScrollText, ShieldCheck, UserCog, X } from "lucide-react";
import { apiRequest, ApiError, type Role, type SessionUser } from "./apiClient";
import { formatTimestamp } from "../utils";

interface ManagedUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface SettingsResponse {
  startMonth: string;
  endMonth: string;
  rowVersion: number;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return formatTimestamp(new Date(value));
}

function LoginView({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await apiRequest<{ user: SessionUser }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      setPassword("");
      onAuthenticated(data.user);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401 ? "Invalid username or password." : "Sign-in could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-7 shadow-2xl space-y-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-indigo-400 font-bold">Energy Monitor Web v3</p>
          <h1 className="text-2xl font-semibold mt-2">Sign in to Settings</h1>
          <p className="text-sm text-slate-400 mt-2">User Management is available to administrators only.</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs text-slate-400 font-semibold">Username</span>
          <input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500" required />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-slate-400 font-semibold">Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500" required />
        </label>
        {error && <p role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 font-semibold">{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}

function AccessDenied() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <section role="alert" data-testid="settings-users-forbidden" className="w-full max-w-lg bg-slate-900 border border-rose-500/30 rounded-3xl p-8 text-center space-y-4">
        <LockKeyhole className="mx-auto w-10 h-10 text-rose-400" />
        <h1 className="text-2xl font-semibold">403 — Access Denied</h1>
        <p className="text-slate-400">User Management is restricted to active administrators.</p>
        <a href="/settings" className="inline-flex rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-sm font-semibold">Back to Settings</a>
      </section>
    </main>
  );
}

function SettingsNav({ user, onLogout }: { user: SessionUser; onLogout: () => Promise<void> }) {
  return (
    <header className="border-b border-slate-800 bg-slate-950/90 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center gap-4 justify-between">
        <div>
          <a href="/settings" className="text-[11px] uppercase tracking-[0.2em] text-indigo-400 font-bold">Energy Monitor</a>
          <p className="text-lg font-semibold mt-1">Settings</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">{user.displayName}</span>
          <span className="rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-2.5 py-1 text-xs font-bold">{user.role}</span>
          <button onClick={() => void onLogout()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-semibold"><LogOut className="w-3.5 h-3.5" /> Sign out</button>
        </div>
      </div>
      <nav aria-label="Settings" className="max-w-7xl mx-auto px-6 pb-4 flex flex-wrap gap-2">
        <a href="/settings" className="rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-semibold">General</a>
        <a href="/settings/display-period" className="rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-semibold">Display Period</a>
        {user.role === "admin" && <a href="/settings/audit" data-testid="settings-audit-nav" className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5"><ScrollText className="w-3.5 h-3.5" /> Audit History</a>}
        {user.role === "admin" && <a href="/settings/users" data-testid="settings-users-nav" className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5"><UserCog className="w-3.5 h-3.5" /> User Management</a>}
      </nav>
    </header>
  );
}

interface GoogleStatusResponse { connected: boolean; email: string | null; updatedAt: string | null; }
interface GoogleBootstrap { sites: Array<{ site: { id: number; name: string }; availableMonths: string[]; latestAvailableMonth: string | null }>; }

function GoogleSheetsSettings() {
  const [status, setStatus] = useState<GoogleStatusResponse | null>(null);
  const [bootstrap, setBootstrap] = useState<GoogleBootstrap | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState(() => localStorage.getItem("energy_monitor_google_spreadsheet_id") ?? "11ODydrVtRwjL3i2MWX6XEw6GSBo_s2guDZsRrVGqBhA");
  const [siteId, setSiteId] = useState(0);
  const [month, setMonth] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextStatus, nextBootstrap] = await Promise.all([apiRequest<GoogleStatusResponse>("/google-sheets/status"), apiRequest<GoogleBootstrap>("/bootstrap")]);
      setStatus(nextStatus); setBootstrap(nextBootstrap);
      const first = nextBootstrap.sites[0];
      setSiteId(current => current || first?.site.id || 0);
      setMonth(current => current || first?.latestAvailableMonth || first?.availableMonths.at(-1) || "");
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Google Sheets status could not be loaded."); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("googleSheets");
    if (!result) return;
    setMessage(result === "connected" ? "Google account connected. Refreshing authorization status." : "Google sign-in did not complete.");
    window.history.replaceState({}, "", "/settings/google-sheets");
    void load();
  }, [load]);

  const selectedSite = bootstrap?.sites.find(item => item.site.id === siteId) ?? bootstrap?.sites[0];
  const saveSpreadsheetId = (value: string) => { setSpreadsheetId(value); localStorage.setItem("energy_monitor_google_spreadsheet_id", value); };
  const run = async (name: string, task: () => Promise<string>) => { setBusy(name); setError(null); setMessage(null); try { setMessage(await task()); } catch (cause) { setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "Google Sheets operation failed."); } finally { setBusy(null); } };
  const syncMonth = () => run("sync", async () => {
    const data = await apiRequest<{ log: unknown | null }>(`/sites/${siteId}/periods/${encodeURIComponent(month)}`);
    if (!data.log) throw new Error("The selected month has no local data to synchronize.");
    await apiRequest("/google-sheets/sync-month", { method: "POST", body: JSON.stringify({ spreadsheet_id: spreadsheetId, log: data.log }) });
    return `Google Sheets synchronized for ${month}.`;
  });
  const exportAll = () => run("export", async () => {
    const data = await apiRequest<{ logs: unknown[] }>(`/sites/${siteId}/export-data`);
    const result = await apiRequest<{ report: unknown | null }>("/google-sheets/export-all", { method: "POST", body: JSON.stringify({ spreadsheet_id: spreadsheetId, logs: data.logs }) });
    return `Exported ${data.logs.length} month(s) to Google Sheets${result.report ? "; integrity report returned." : "."}`;
  });
  const importAll = () => run("import", async () => {
    const result = await apiRequest<{ logs: unknown[]; persisted: boolean }>("/google-sheets/import-all", { method: "POST", body: JSON.stringify({ spreadsheet_id: spreadsheetId, site_id: siteId, persist: true }) });
    return `Imported and persisted ${result.logs.length} month(s) from Google Sheets.`;
  });

  return <section className="max-w-7xl mx-auto px-6 py-8 space-y-6" data-testid="settings-google-sheets"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Settings / Google Sheets</p><h1 className="text-3xl font-semibold mt-2">Google Sheets Core Sync</h1><p className="text-slate-400 mt-2">Server-side OAuth with Desktop-compatible four-tab diff, upload and read-back verification. OAuth tokens never enter the browser.</p></div>{error && <p role="alert" className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>}{message && <p role="status" className="text-sm text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">{message}</p>}<div className="grid lg:grid-cols-2 gap-5"><article className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"><div className="flex items-center gap-3"><FileSpreadsheet className="w-6 h-6 text-emerald-300" /><div><h2 className="font-semibold">Connection</h2><p className="text-xs text-slate-500 mt-1">{status?.connected ? `Connected as ${status.email ?? "Google account"}` : "Not connected"}</p></div></div>{status?.connected ? <button type="button" disabled={busy !== null} onClick={() => void run("signout", async () => { await apiRequest("/google-sheets/sign-out", { method: "POST" }); await load(); return "Google account disconnected."; })} className="rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold">{busy === "signout" ? "Disconnecting…" : "Disconnect"}</button> : <button type="button" onClick={() => { window.location.href = "/api/v1/google-sheets/auth/start"; }} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-semibold">Sign in with Google</button>}</article><article className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"><h2 className="font-semibold">Spreadsheet and scope</h2><label className="block text-xs text-slate-400">Spreadsheet ID<input value={spreadsheetId} onChange={event => saveSpreadsheetId(event.target.value)} className="field mt-1 w-full" placeholder="Google Spreadsheet ID" /></label><div className="grid sm:grid-cols-2 gap-3"><label className="block text-xs text-slate-400">Site<select value={siteId} onChange={event => { setSiteId(Number(event.target.value)); setMonth(""); }} className="field mt-1 w-full">{bootstrap?.sites.map(item => <option key={item.site.id} value={item.site.id}>{item.site.name}</option>)}</select></label><label className="block text-xs text-slate-400">Month<select value={month} onChange={event => setMonth(event.target.value)} className="field mt-1 w-full"><option value="">Select month</option>{selectedSite?.availableMonths.map(item => <option key={item} value={item}>{item}</option>)}</select></label></div></article></div><article className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4"><h2 className="font-semibold">Synchronization</h2><p className="text-sm text-slate-400">The selected operation uses the same sheet discovery, duplicate guard, targeted patch and post-write verification as the Desktop application.</p><div className="flex flex-wrap gap-3"><button type="button" disabled={!status?.connected || !siteId || !month || busy !== null} onClick={() => void syncMonth()} className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold">{busy === "sync" ? "Syncing…" : "Sync Active Month"}</button><button type="button" disabled={!status?.connected || !siteId || busy !== null} onClick={() => void exportAll()} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold">{busy === "export" ? "Exporting…" : "Export All Months"}</button><button type="button" disabled={!status?.connected || !siteId || busy !== null} onClick={() => void importAll()} className="rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold">{busy === "import" ? "Importing…" : "Import and Persist All"}</button></div><p className="text-xs text-slate-500">Import writes through the Web transaction boundary and records Google Sheets provenance. A duplicate or failed read-back stops the operation.</p></article></section>;
}

interface WorkbookBackup { id: number; sourceFileName: string; sourceFileHash: string; contentType: string; byteSize: number; importedAt: string; isCurrent: boolean; }
function WorkbookBackupsSettings() {
  const [siteId, setSiteId] = useState(0);
  const [sites, setSites] = useState<Array<{ id: number; name: string }>>([]);
  const [backups, setBackups] = useState<WorkbookBackup[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async (nextSiteId = 0) => {
    try {
      const bootstrap = await apiRequest<{ sites: Array<{ site: { id: number; name: string } }> }>("/bootstrap");
      const nextSites = bootstrap.sites.map(item => item.site); setSites(nextSites);
      const activeSiteId = nextSiteId || nextSites[0]?.id || 0; setSiteId(activeSiteId);
      if (activeSiteId) setBackups(await apiRequest<WorkbookBackup[]>(`/sites/${activeSiteId}/workbook-backups`));
      setError(null);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Workbook backups could not be loaded."); }
  }, []);
  useEffect(() => { void load(0); }, [load]);
  const restore = async (backup: WorkbookBackup) => {
    if (!window.confirm(`Restore ${backup.sourceFileName}? Current workbook data will be replaced transactionally.`)) return;
    setBusy(backup.id); setError(null); setMessage(null);
    try { await apiRequest(`/sites/${siteId}/workbook-backups/${backup.id}/restore`, { method: "POST", body: JSON.stringify({}) }); setMessage(`Restored ${backup.sourceFileName} and revalidated the workbook.`); await load(siteId); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Workbook restore failed."); }
    finally { setBusy(null); }
  };
  return <section className="max-w-7xl mx-auto px-6 py-8 space-y-6" data-testid="settings-workbook-backups"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Settings / Workbook Backups</p><h1 className="text-3xl font-semibold mt-2">Workbook Backup and Recovery</h1><p className="text-slate-400 mt-2">Retained source workbooks are immutable, SHA-256 verified and restorable through the same validation and transaction pipeline as import.</p></div>{error && <p role="alert" className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>}{message && <p role="status" className="text-sm text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">{message}</p>}<div className="flex flex-wrap items-end gap-3"><label className="text-xs text-slate-400">Site<select value={siteId} onChange={event => { const next = Number(event.target.value); setSiteId(next); void load(next); }} className="field mt-1"><option value={0}>Select site</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><button type="button" onClick={() => void load(siteId)} className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-sm font-semibold">Refresh</button></div><div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden"><div className="overflow-x-auto"><table className="min-w-[900px] w-full text-sm"><thead className="bg-slate-950/80 text-left text-xs text-slate-400 uppercase tracking-wider"><tr><th className="px-4 py-3">Workbook</th><th className="px-4 py-3">Imported</th><th className="px-4 py-3">SHA-256</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-800">{backups.map(backup => <tr key={backup.id}><td className="px-4 py-4 font-semibold">{backup.sourceFileName}<p className="text-xs text-slate-500 mt-1">{backup.byteSize.toLocaleString()} bytes</p></td><td className="px-4 py-4 text-slate-400">{formatDate(backup.importedAt)}</td><td className="px-4 py-4 text-xs text-slate-500 font-mono">{backup.sourceFileHash}</td><td className="px-4 py-4">{backup.isCurrent ? <span className="text-emerald-300 font-semibold">Current</span> : <span className="text-slate-400">Retained</span>}</td><td className="px-4 py-4"><button type="button" disabled={busy !== null || backup.isCurrent} onClick={() => void restore(backup)} className="rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold">{busy === backup.id ? "Restoring…" : "Restore"}</button></td></tr>)}{backups.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No retained workbook versions found.</td></tr>}</tbody></table></div></div><p className="text-xs text-slate-500">This application-level recovery is separate from Supabase PITR/database disaster recovery; the Production gate still requires an approved restore drill and measured RPO/RTO.</p></section>;
}

function SettingsHome({ user }: { user: SessionUser }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setSettings(await apiRequest<SettingsResponse>("/settings")); setError(null); } catch { setError("Settings could not be loaded."); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || user.role !== "admin" || busy) return;
    setBusy(true); setSaved(false); setError(null);
    const form = new FormData(event.currentTarget as HTMLFormElement);
    try {
      await apiRequest<SettingsResponse>("/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: form.get("start_month"), end_month: form.get("end_month"), expected_row_version: settings.rowVersion }) });
      await load(); setSaved(true);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setError("Display Period ถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดค่าล่าสุดก่อนบันทึก");
      else if (cause instanceof ApiError && cause.status === 423) setError("READ_ONLY_MODE: ไม่อนุญาตให้แก้ไขการตั้งค่า");
      else setError(cause instanceof ApiError ? cause.message : "Display Period could not be updated.");
    } finally { setBusy(false); }
  };

  return (
    <section className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-bold">Settings</p>
        <h1 className="text-3xl font-semibold mt-2">Application settings</h1>
        <p className="text-slate-400 mt-2">Effective settings are available to authenticated users. Administrative controls are shown according to the server session role.</p>
      </div>
      {error && <p role="alert" className="text-rose-300 flex flex-wrap items-center gap-3"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold">Reload latest</button></p>}
      <div className="grid md:grid-cols-2 gap-5">
        <article className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="font-semibold">General</h2>
          <p className="text-sm text-slate-400">Signed in as {user.username}. The Web v3 API remains the authorization boundary.</p>
        </article>
        <article className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="font-semibold">Global Display Period</h2>
          {settings ? <p className="text-sm text-slate-300">{settings.startMonth} → {settings.endMonth} <span className="text-xs text-slate-500">(row_version {settings.rowVersion})</span></p> : <p className="text-sm text-slate-500">Loading…</p>}
          {user.role === "admin" && settings && <form onSubmit={save} className="grid sm:grid-cols-3 gap-3 pt-2"><label className="text-xs text-slate-400">Start month<input name="start_month" type="month" defaultValue={settings.startMonth} className="field mt-1 w-full" required /></label><label className="text-xs text-slate-400">End month<input name="end_month" type="month" defaultValue={settings.endMonth} className="field mt-1 w-full" required /></label><button disabled={busy} className="self-end rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold">{busy ? "Saving…" : "Save Display Period"}</button></form>}
          {saved && <p role="status" className="text-xs text-emerald-300">Saved. Bootstrap will use the new contiguous month range.</p>}
          <p className="text-xs text-slate-500">Only administrators can change this setting. The server validates range and optimistic row_version.</p>
        </article>
      </div>
    </section>
  );
}

function UserManagementPage({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "user" as Role, active: true });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await apiRequest<ManagedUser[]>("/admin/users"));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 403 ? "403 — Access Denied" : "Users could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const submitAdd = async (event: FormEvent) => {
    event.preventDefault();
    setBusyKey("add");
    setError(null);
    try {
      await apiRequest<ManagedUser>("/admin/users", { method: "POST", body: JSON.stringify({ username: form.username, display_name: form.displayName, password: form.password, role: form.role, active: form.active }) });
      setForm({ username: "", displayName: "", password: "", role: "user", active: true });
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "User could not be created.");
    } finally {
      setBusyKey(null);
    }
  };

  const saveDisplayName = async (userId: string) => {
    setBusyKey(`display:${userId}`);
    try {
      await apiRequest<ManagedUser>(`/admin/users/${encodeURIComponent(userId)}/display-name`, { method: "PATCH", body: JSON.stringify({ display_name: displayNameDraft }) });
      setEditingId(null);
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Display name could not be updated.");
    } finally {
      setBusyKey(null);
    }
  };

  const changeRole = async (user: ManagedUser, role: Role) => {
    if (user.role === role) return;
    if (user.role === "admin" && role === "user" && !window.confirm("Change this administrator to User?")) return;
    setBusyKey(`role:${user.id}`);
    try {
      await apiRequest<ManagedUser>(`/admin/users/${encodeURIComponent(user.id)}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Role could not be changed.");
    } finally {
      setBusyKey(null);
    }
  };

  const changeActive = async (user: ManagedUser) => {
    if (user.active && !window.confirm("Deactivate this user? Existing sessions will be revoked.")) return;
    setBusyKey(`active:${user.id}`);
    try {
      await apiRequest<ManagedUser>(`/admin/users/${encodeURIComponent(user.id)}/active`, { method: "PATCH", body: JSON.stringify({ active: !user.active }) });
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "User status could not be changed.");
    } finally {
      setBusyKey(null);
    }
  };

  const submitReset = async (event: FormEvent, userId: string) => {
    event.preventDefault();
    if (!window.confirm("Reset this user's password and revoke all existing sessions?")) return;
    setBusyKey(`reset:${userId}`);
    try {
      await apiRequest<ManagedUser>(`/admin/users/${encodeURIComponent(userId)}/password`, { method: "POST", body: JSON.stringify({ password: resetPassword }) });
      setResetId(null);
      setResetPassword("");
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Password could not be reset.");
    } finally {
      setBusyKey(null);
    }
  };

  const deleteUser = async (user: ManagedUser) => {
    if (user.id === currentUserId) return;
    if (deleteId !== user.id) { setDeleteId(user.id); setError(null); return; }
    setBusyKey(`delete:${user.id}`);
    try {
      await apiRequest(`/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      setDeleteId(null);
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "User could not be deleted.");
    } finally {
      setBusyKey(null);
    }
  };

  const orderedUsers = useMemo(() => [...users].sort((a, b) => a.username.localeCompare(b.username)), [users]);

  return (
    <section className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Settings / User Management</p>
          <h1 className="text-3xl font-semibold mt-2">User Management</h1>
          <p className="text-slate-400 mt-2">Manage local application accounts. Passwords, hashes, sessions, and database identifiers are never displayed.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-3 py-2 text-xs font-semibold"><ShieldCheck className="w-4 h-4" /> Admin only</div>
      </div>

      {error && <p role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>}

      <form onSubmit={submitAdd} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2"><Plus className="w-4 h-4 text-indigo-400" /><h2 className="font-semibold">Add User</h2></div>
        <div className="grid md:grid-cols-5 gap-3">
          <input aria-label="Username" placeholder="Username" autoComplete="off" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} className="field" required />
          <input aria-label="Display Name" placeholder="Display Name" value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} className="field" required />
          <input aria-label="Initial Password" placeholder="Initial Password" type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} className="field" required />
          <select aria-label="Role" value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Role })} className="field"><option value="user">User</option><option value="admin">Admin</option></select>
          <button disabled={busyKey === "add"} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold">{busyKey === "add" ? "Adding…" : "Add User"}</button>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} /> Active</label>
      </form>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-950/80 text-left text-xs text-slate-400 uppercase tracking-wider"><tr><th className="px-4 py-3">Username</th><th className="px-4 py-3">Display Name</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last Login</th><th className="px-4 py-3">Created At</th><th className="px-4 py-3">Actions</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {loading && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading users…</td></tr>}
              {!loading && orderedUsers.map(user => (
                <tr key={user.username} className="align-top">
                  <td className="px-4 py-4 font-semibold text-slate-200">{user.username}</td>
                  <td className="px-4 py-4">
                    {editingId === user.id ? <div className="flex gap-2"><input aria-label={`Edit ${user.username} display name`} value={displayNameDraft} onChange={event => setDisplayNameDraft(event.target.value)} className="field min-w-48" /><button type="button" disabled={busyKey === `display:${user.id}`} onClick={() => void saveDisplayName(user.id)} className="icon-button text-emerald-300"><Check className="w-4 h-4" /></button><button type="button" onClick={() => setEditingId(null)} className="icon-button text-slate-400"><X className="w-4 h-4" /></button></div> : <div className="flex items-center gap-2"><span>{user.displayName}</span><button type="button" aria-label={`Edit ${user.username} display name`} onClick={() => { setEditingId(user.id); setDisplayNameDraft(user.displayName); }} className="icon-button text-slate-500 hover:text-indigo-300"><Pencil className="w-3.5 h-3.5" /></button></div>}
                  </td>
                  <td className="px-4 py-4"><select aria-label={`${user.username} role`} value={user.role} disabled={busyKey === `role:${user.id}`} onChange={event => void changeRole(user, event.target.value as Role)} className="field py-1.5"><option value="user">User</option><option value="admin">Admin</option></select></td>
                  <td className="px-4 py-4"><button type="button" onClick={() => void changeActive(user)} disabled={busyKey === `active:${user.id}`} className={`rounded-full px-2.5 py-1 text-xs font-bold ${user.active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{user.active ? "Active" : "Inactive"}</button></td>
                  <td className="px-4 py-4 text-slate-400">{formatDate(user.lastLoginAt)}</td>
                  <td className="px-4 py-4 text-slate-400">{formatDate(user.createdAt)}</td>
                  <td className="px-4 py-4 space-y-2">
                    {resetId === user.id ? <form onSubmit={event => void submitReset(event, user.id)} className="flex gap-2"><input aria-label={`New password for ${user.username}`} type="password" autoComplete="new-password" placeholder="New password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} className="field w-40" required /><button disabled={busyKey === `reset:${user.id}`} className="rounded-lg bg-amber-600 hover:bg-amber-500 px-2.5 py-1.5 text-xs font-semibold">Set</button><button type="button" onClick={() => { setResetId(null); setResetPassword(""); }} className="icon-button text-slate-400"><X className="w-4 h-4" /></button></form> : <button type="button" onClick={() => setResetId(user.id)} className="rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-semibold">Reset Password</button>}
                    {deleteId === user.id ? <div className="flex items-center gap-2"><span className="text-[11px] text-rose-300">Delete user?</span><button type="button" disabled={busyKey === `delete:${user.id}`} onClick={() => void deleteUser(user)} className="rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-50 px-2.5 py-1.5 text-xs font-semibold">Confirm</button><button type="button" onClick={() => setDeleteId(null)} className="icon-button text-slate-400"><X className="w-4 h-4" /></button></div> : <button type="button" disabled={user.id === currentUserId} title={user.id === currentUserId ? "The current administrator cannot be deleted." : "Delete this user and revoke active sessions."} onClick={() => void deleteUser(user)} className="rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-40 px-2.5 py-1.5 text-xs font-semibold">Delete User</button>}
                  </td>
                </tr>
              ))}
              {!loading && orderedUsers.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

interface AuditRecordResponse { id: string; actorUserId: string | null; action: string; entityType: string; entityId: string; occurredAt: string; previousValue: unknown; newValue: unknown; correlationId: string; }

function AuditHistoryPage() {
  const [records, setRecords] = useState<AuditRecordResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setRecords(await apiRequest<AuditRecordResponse[]>("/admin/audit?limit=100")); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Audit history could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="max-w-7xl mx-auto px-6 py-8 space-y-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Settings / Audit History</p><h1 className="text-3xl font-semibold mt-2">Audit History</h1><p className="text-slate-400 mt-2">Read-only operational and authentication events. Secrets are scrubbed at the server boundary.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-3 py-2 text-sm font-semibold">Refresh</button></div>{error && <p role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>}<div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden"><div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-sm"><thead className="bg-slate-950/80 text-left text-xs text-slate-400 uppercase tracking-wider"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Entity</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Correlation</th><th className="px-4 py-3">Change</th></tr></thead><tbody className="divide-y divide-slate-800">{loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading audit history…</td></tr>}{!loading && records.map(record => <tr key={record.id} className="align-top"><td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(record.occurredAt)}</td><td className="px-4 py-3 font-semibold text-slate-200">{record.action}</td><td className="px-4 py-3 text-slate-300">{record.entityType} / {record.entityId}</td><td className="px-4 py-3 text-slate-400">{record.actorUserId ?? "system"}</td><td className="px-4 py-3 text-xs text-slate-500 font-mono">{record.correlationId}</td><td className="px-4 py-3 text-xs text-slate-400"><pre className="max-w-[360px] whitespace-pre-wrap">{JSON.stringify({ previous: record.previousValue, next: record.newValue })}</pre></td></tr>)}{!loading && records.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No audit events found.</td></tr>}</tbody></table></div></div></section>;
}

export default function WebV3SettingsApp() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const route = window.location.pathname.replace(/\/+$/, "") || "/settings";
  const usersRoute = route === "/settings/users";
  const auditRoute = route === "/settings/audit";

  useEffect(() => {
    void apiRequest<{ authenticated: boolean; user: SessionUser | null }>("/auth/session")
      .then(result => setUser(result.authenticated ? result.user : null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    try { await apiRequest("/auth/logout", { method: "POST" }); } finally { setUser(null); }
  };

  if (loading) return <main className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center">Loading…</main>;
  if (!user) return <LoginView onAuthenticated={setUser} />;
  if ((usersRoute || auditRoute) && user.role !== "admin") return <AccessDenied />;
  if (auditRoute && user.role !== "admin") return <AccessDenied />;

  return <div className="min-h-screen bg-slate-950 text-slate-100"><SettingsNav user={user} onLogout={logout} />{usersRoute ? <UserManagementPage currentUserId={user.id} /> : auditRoute ? <AuditHistoryPage /> : <SettingsHome user={user} />}</div>;
}
