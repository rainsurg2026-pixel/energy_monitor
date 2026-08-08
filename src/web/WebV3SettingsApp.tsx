import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Check, LockKeyhole, LogOut, Pencil, Plus, ShieldCheck, UserCog, X } from "lucide-react";

type Role = "admin" | "user";

interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: true;
}

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

interface ApiResponse<T> {
  ok: true;
  data: T;
}

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function csrfToken(): string | undefined {
  const item = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("em_csrf="));
  return item ? decodeURIComponent(item.slice("em_csrf=".length)) : undefined;
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) headers.set("x-csrf-token", token);
  }
  const response = await fetch(`/api/v1${path}`, { ...init, method, headers, credentials: "include" });
  const payload = await response.json().catch(() => null) as ApiResponse<T> | { ok?: false; error?: { code?: string; message?: string } } | null;
  if (!response.ok || !payload || payload.ok !== true) {
    const error = payload && "error" in payload ? payload.error : undefined;
    throw new ApiError(response.status, error?.code ?? "REQUEST_FAILED", error?.message ?? "The request could not be completed.");
  }
  return payload.data;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
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
        {user.role === "admin" && <a href="/settings/users" data-testid="settings-users-nav" className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5"><UserCog className="w-3.5 h-3.5" /> User Management</a>}
      </nav>
    </header>
  );
}

function SettingsHome({ user }: { user: SessionUser }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<SettingsResponse>("/settings").then(setSettings).catch(() => setError("Settings could not be loaded."));
  }, []);

  return (
    <section className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-bold">Settings</p>
        <h1 className="text-3xl font-semibold mt-2">Application settings</h1>
        <p className="text-slate-400 mt-2">Effective settings are available to authenticated users. Administrative controls are shown according to the server session role.</p>
      </div>
      {error && <p role="alert" className="text-rose-300">{error}</p>}
      <div className="grid md:grid-cols-2 gap-5">
        <article className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="font-semibold">General</h2>
          <p className="text-sm text-slate-400">Signed in as {user.username}. The Web v3 API remains the authorization boundary.</p>
        </article>
        <article className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="font-semibold">Global Display Period</h2>
          {settings ? <p className="text-sm text-slate-300">{settings.startMonth} → {settings.endMonth}</p> : <p className="text-sm text-slate-500">Loading…</p>}
          <p className="text-xs text-slate-500">Only administrators can change this setting.</p>
        </article>
      </div>
    </section>
  );
}

function UserManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "user" as Role, active: true });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
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
                  <td className="px-4 py-4">
                    {resetId === user.id ? <form onSubmit={event => void submitReset(event, user.id)} className="flex gap-2"><input aria-label={`New password for ${user.username}`} type="password" autoComplete="new-password" placeholder="New password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} className="field w-40" required /><button disabled={busyKey === `reset:${user.id}`} className="rounded-lg bg-amber-600 hover:bg-amber-500 px-2.5 py-1.5 text-xs font-semibold">Set</button><button type="button" onClick={() => { setResetId(null); setResetPassword(""); }} className="icon-button text-slate-400"><X className="w-4 h-4" /></button></form> : <button type="button" onClick={() => setResetId(user.id)} className="rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-semibold">Reset Password</button>}
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

export default function WebV3SettingsApp() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const route = window.location.pathname.replace(/\/+$/, "") || "/settings";
  const usersRoute = route === "/settings/users";

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
  if (usersRoute && user.role !== "admin") return <AccessDenied />;

  return <div className="min-h-screen bg-slate-950 text-slate-100"><SettingsNav user={user} onLogout={logout} />{usersRoute ? <UserManagementPage /> : <SettingsHome user={user} />}</div>;
}
