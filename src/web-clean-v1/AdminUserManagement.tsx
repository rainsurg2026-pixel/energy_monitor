import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, Eye, EyeOff, KeyRound, Pencil, RefreshCw, Search, ShieldCheck, Trash2, UserCheck, UserPlus, UsersRound, UserX } from "lucide-react";
import { api, type Role } from "./api";
import type { AppLanguage } from "./theme";
import { formatWebSavedTimestamp } from "./formatting";

type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

const PASSWORD_MIN_LENGTH = 6;
const readError = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
const passwordHelp = (lang: AppLanguage) => lang === "th" ? `ต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` : `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
const inputClass = "mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10";
function exportUsersCsv(users: AdminUser[]): void {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows = [
    ["Display Name", "Username", "Role", "Status", "Created At", "Last Login"],
    ...users.map(user => [user.displayName, user.username, user.role, user.active ? "Enabled" : "Disabled", user.createdAt, user.lastLoginAt ?? ""])
  ];
  const csv = rows.map(row => row.map(value => escape(String(value))).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "Energy_Monitor_User_List.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function AdminUserManagement({ lang }: { lang: AppLanguage }) {
  const th = lang === "th";
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ username: "", display_name: "", password: "", role: "user" as Role, active: true });
  const [resetUserId, setResetUserId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [showInitialPassword, setShowInitialPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await api<AdminUser[]>("/admin/users")); }
    catch (error) { setMessage(readError(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const totalUsers = users.length;
  const activeUsers = users.filter(user => user.active).length;
  const adminUsers = users.filter(user => user.role === "admin").length;
  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter(user => {
      const matchesQuery = !needle || `${user.displayName} ${user.username}`.toLowerCase().includes(needle);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesStatus = statusFilter === "all" || (statusFilter === "enabled" ? user.active : !user.active);
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [query, roleFilter, statusFilter, users]);
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (Array.from(form.password).length < PASSWORD_MIN_LENGTH || /^\s*$/u.test(form.password)) { setMessage(passwordHelp(lang)); return; }
    try {
      await api("/admin/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ username: "", display_name: "", password: "", role: "user", active: true });
      setMessage(th ? "สร้างผู้ใช้แล้ว" : "User created.");
      await load();
    } catch (error) { setMessage(readError(error)); }
  };

  const reset = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetUserId) return;
    if (Array.from(resetPassword).length < PASSWORD_MIN_LENGTH || /^\s*$/u.test(resetPassword)) { setMessage(passwordHelp(lang)); return; }
    try {
      await api(`/admin/users/${resetUserId}/password`, { method: "POST", body: JSON.stringify({ password: resetPassword }) });
      setResetPassword("");
      setMessage(th ? "รีเซ็ตรหัสผ่านและยกเลิกเซสชันแล้ว" : "Password reset and sessions revoked.");
    } catch (error) { setMessage(readError(error)); }
  };

  const active = async (target: AdminUser) => {
    if (target.active && !window.confirm(th ? `ปิดใช้งานผู้ใช้ "${target.displayName}" (${target.username})? เซสชันเดิมจะถูกยกเลิก` : `Disable user "${target.displayName}" (${target.username})? Existing sessions will be revoked.`)) return;
    try { await api(`/admin/users/${target.id}/active`, { method: "PATCH", body: JSON.stringify({ active: !target.active }) }); await load(); }
    catch (error) { setMessage(readError(error)); }
  };
  const changeRole = async (target: AdminUser, role: Role) => {
    if (role === target.role) return;
    if (!window.confirm(th ? `เปลี่ยนบทบาท "${target.displayName}" (${target.username}) จาก ${target.role} เป็น ${role} ใช่หรือไม่` : `Change "${target.displayName}" (${target.username}) from ${target.role} to ${role}?`)) return;
    try {
      await api(`/admin/users/${target.id}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
      setMessage(th ? "อัปเดตบทบาทแล้ว" : "Role updated.");
      await load();
    } catch (error) { setMessage(readError(error)); await load(); }
  };

  const saveDisplayName = async (target: AdminUser) => {
    const displayName = displayNameDraft.trim();
    if (!displayName) { setMessage(th ? "ต้องระบุชื่อที่แสดง" : "Display name is required."); return; }
    try {
      await api(`/admin/users/${target.id}/display-name`, { method: "PATCH", body: JSON.stringify({ display_name: displayName }) });
      setEditingUserId(null);
      setMessage(th ? "อัปเดตชื่อที่แสดงแล้ว" : "Display name updated.");
      await load();
    } catch (error) { setMessage(readError(error)); }
  };

  const remove = async (target: AdminUser) => {
    if (!window.confirm(th ? `ลบผู้ใช้ "${target.displayName}" (${target.username})? ไม่สามารถย้อนกลับได้` : `Delete user "${target.displayName}" (${target.username})? This cannot be undone.`)) return;
    try { await api<void>(`/admin/users/${target.id}`, { method: "DELETE" }); setMessage(th ? "ลบผู้ใช้แล้ว" : "User deleted."); await load(); }
    catch (error) { setMessage(readError(error)); }
  };
  return <section className="space-y-5" data-testid="admin-user-management">
    <div>
      <h2 className="font-display text-2xl font-bold text-slate-100">{th ? "จัดการผู้ใช้" : "User Management"}</h2>
      <p className="mt-1 text-sm text-slate-400">{th ? "จัดการบัญชี บทบาท การรีเซ็ตรหัสผ่าน และสถานะการเข้าใช้งาน" : "Manage accounts, roles, password resets, and access status."}</p>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <article className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
        <div className="rounded-2xl bg-sky-500/15 p-3 text-sky-300"><UsersRound className="h-7 w-7" /></div>
        <div><p className="text-sm font-medium text-slate-400">{th ? "ผู้ใช้ทั้งหมด" : "Total Users"}</p><p className="mt-1 text-2xl font-bold text-slate-100">{totalUsers}</p></div>
      </article>
      <article className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
        <div className="rounded-2xl bg-emerald-500/15 p-3 text-emerald-300"><UserCheck className="h-7 w-7" /></div>
        <div><p className="text-sm font-medium text-slate-400">{th ? "ผู้ใช้ที่เปิดใช้งาน" : "Active Users"}</p><p className="mt-1 text-2xl font-bold text-slate-100">{activeUsers}</p></div>
      </article>
      <article className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
        <div className="rounded-2xl bg-indigo-500/15 p-3 text-indigo-300"><ShieldCheck className="h-7 w-7" /></div>
        <div><p className="text-sm font-medium text-slate-400">{th ? "ผู้ดูแลระบบ" : "Admins"}</p><p className="mt-1 text-2xl font-bold text-slate-100">{adminUsers}</p></div>
      </article>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <form onSubmit={create} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
          <div className="rounded-xl bg-teal-500/10 p-2.5 text-teal-300"><UserPlus className="h-5 w-5" /></div>
          <div><h3 className="font-semibold text-slate-100">{th ? "เพิ่มผู้ใช้ใหม่" : "Add New User"}</h3><p className="mt-0.5 text-xs text-slate-400">{th ? "สร้างบัญชีพร้อมบทบาทและรหัสผ่านเริ่มต้น" : "Create a new user account with role and initial password."}</p></div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-300">{th ? "ชื่อผู้ใช้" : "Username"}<span className="text-rose-400"> *</span><input required placeholder={th ? "กรอกชื่อผู้ใช้" : "Enter username"} value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} className={inputClass} /></label>
          <label className="text-xs font-medium text-slate-300">{th ? "ชื่อที่แสดง" : "Display name"}<span className="text-rose-400"> *</span><input required placeholder={th ? "กรอกชื่อที่แสดง" : "Enter display name"} value={form.display_name} onChange={event => setForm({ ...form, display_name: event.target.value })} className={inputClass} /></label>
          <label className="text-xs font-medium text-slate-300 sm:col-span-2">{th ? "รหัสผ่านเริ่มต้น" : "Initial password"}<span className="text-rose-400"> *</span><div className="relative"><input required type={showInitialPassword ? "text" : "password"} placeholder={th ? "กรอกรหัสผ่านเริ่มต้น" : "Enter initial password"} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} className={`${inputClass} pr-11`} /><button type="button" onClick={() => setShowInitialPassword(value => !value)} className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-500 hover:text-slate-200" aria-label={showInitialPassword ? "Hide password" : "Show password"}>{showInitialPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
          <label className="text-xs font-medium text-slate-300">{th ? "บทบาท" : "Role"}<span className="text-rose-400"> *</span><select aria-label="Role" value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Role })} className={inputClass}><option value="user">User</option><option value="admin">Admin</option></select></label>
          <div className="flex items-end justify-between gap-3">
            <label className="flex min-h-11 flex-1 items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })} className="h-4 w-4 accent-teal-500" /><span><b className="block text-slate-200">{th ? "เปิดใช้งาน" : "Active"}</b><span className="text-[11px] text-slate-500">{th ? "ผู้ใช้สามารถเข้าสู่ระบบได้" : "User can log in to the system"}</span></span></label>
          </div>
          <div className="sm:col-span-2 flex justify-end"><button className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-teal-500/10 hover:bg-teal-400"><UserPlus className="h-4 w-4" />{th ? "เพิ่มผู้ใช้" : "Add User"}</button></div>
        </div>
      </form>

      <form onSubmit={reset} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-800 px-5 py-4">
          <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-300"><KeyRound className="h-5 w-5" /></div>
          <div><h3 className="font-semibold text-slate-100">{th ? "รีเซ็ตรหัสผ่าน" : "Reset Password"}</h3><p className="mt-0.5 text-xs text-slate-400">{th ? "กำหนดรหัสผ่านใหม่ให้ผู้ใช้ที่มีอยู่" : "Set a new password for an existing user."}</p></div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-300">{th ? "เลือกผู้ใช้" : "Select user"}<span className="text-rose-400"> *</span><select required value={resetUserId} onChange={event => setResetUserId(event.target.value)} className={inputClass}><option value="">{th ? "เลือกผู้ใช้" : "Choose a user"}</option>{users.map(target => <option key={target.id} value={target.id}>{target.displayName} · {target.username}</option>)}</select></label>
          <label className="text-xs font-medium text-slate-300">{th ? "รหัสผ่านใหม่" : "New password"}<span className="text-rose-400"> *</span><div className="relative"><input required type={showResetPassword ? "text" : "password"} placeholder={th ? "กรอกรหัสผ่านใหม่" : "Enter new password"} value={resetPassword} onChange={event => setResetPassword(event.target.value)} className={`${inputClass} pr-11`} /><button type="button" onClick={() => setShowResetPassword(value => !value)} className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-slate-500 hover:text-slate-200" aria-label={showResetPassword ? "Hide password" : "Show password"}>{showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
          <div className="sm:col-span-2 flex justify-end"><button className="inline-flex min-w-44 items-center justify-center gap-2 rounded-xl border border-amber-500/60 px-4 py-2.5 text-sm font-bold text-amber-300 hover:bg-amber-500/10"><RefreshCw className="h-4 w-4" />{th ? "รีเซ็ตรหัสผ่าน" : "Reset Password"}</button></div>
        </div>
      </form>
    </div>
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-cyan-500/10 p-2.5 text-cyan-300"><UsersRound className="h-5 w-5" /></div><div><h3 className="font-semibold text-slate-100">{th ? "รายชื่อผู้ใช้" : "User List"}</h3><p className="mt-0.5 text-xs text-slate-400">{th ? "ค้นหาและจัดการบัญชีผู้ใช้ทั้งหมด" : "Search and manage all user accounts."}</p></div></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:items-center">
          <label className="relative sm:col-span-2 lg:w-72"><span className="sr-only">{th ? "ค้นหาผู้ใช้" : "Search users"}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={th ? "ค้นหาชื่อหรือชื่อผู้ใช้..." : "Search by name or username..."} className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-teal-500" /></label>
          <select aria-label={th ? "กรองบทบาท" : "Role filter"} value={roleFilter} onChange={event => setRoleFilter(event.target.value as "all" | Role)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm"><option value="all">{th ? "ทุกบทบาท" : "All Roles"}</option><option value="user">User</option><option value="admin">Admin</option></select>
          <select aria-label={th ? "กรองสถานะ" : "Status filter"} value={statusFilter} onChange={event => setStatusFilter(event.target.value as "all" | "enabled" | "disabled")} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm"><option value="all">{th ? "ทุกสถานะ" : "All Status"}</option><option value="enabled">{th ? "เปิดใช้งาน" : "Enabled"}</option><option value="disabled">{th ? "ปิดใช้งาน" : "Disabled"}</option></select>
          <button type="button" onClick={() => exportUsersCsv(filteredUsers)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2.5 text-sm text-slate-300 hover:border-slate-500 hover:bg-slate-800"><Download className="h-4 w-4" />{th ? "ส่งออก" : "Export"}</button>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2.5 text-sm text-slate-300 hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{th ? "รีเฟรช" : "Refresh"}</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-5 py-3">{th ? "ชื่อที่แสดง" : "Display Name"}</th><th className="px-4 py-3">{th ? "ชื่อผู้ใช้" : "Username"}</th><th className="px-4 py-3">{th ? "บทบาท" : "Role"}</th><th className="px-4 py-3">{th ? "สถานะ" : "Status"}</th><th className="px-4 py-3">{th ? "เข้าสู่ระบบล่าสุด" : "Last Login"}</th><th className="px-5 py-3 text-right">{th ? "การดำเนินการ" : "Actions"}</th></tr>
          </thead>
          <tbody>
            {filteredUsers.map(target => <tr key={target.id} className="border-t border-slate-800/80 text-slate-300 hover:bg-slate-800/25">
              <td className="px-5 py-3.5">
                {editingUserId === target.id ? <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); void saveDisplayName(target); }}><input required aria-label={`${th ? "ชื่อที่แสดงของ" : "Display name for"} ${target.username}`} value={displayNameDraft} onChange={event => setDisplayNameDraft(event.target.value)} className="min-w-48 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm" /><button className="text-xs font-semibold text-teal-300">{th ? "บันทึก" : "Save"}</button><button type="button" onClick={() => setEditingUserId(null)} className="text-xs text-slate-500 hover:text-slate-300">{th ? "ยกเลิก" : "Cancel"}</button></form> : <span className="font-semibold text-slate-100">{target.displayName}</span>}
              </td>
              <td className="px-4 py-3.5 font-mono text-xs text-slate-400">{target.username}</td>
              <td className="px-4 py-3.5"><select aria-label={`Role for ${target.username}`} value={target.role} onChange={event => void changeRole(target, event.target.value as Role)} className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm"><option value="user">User</option><option value="admin">Admin</option></select></td>
              <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold ${target.active ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-slate-600 bg-slate-800 text-slate-400"}`}><span className={`h-2 w-2 rounded-full ${target.active ? "bg-emerald-400" : "bg-slate-500"}`} />{target.active ? (th ? "เปิดใช้งาน" : "Enabled") : (th ? "ปิดใช้งาน" : "Disabled")}</span></td>
              <td className="px-4 py-3.5 text-xs text-slate-400">{target.lastLoginAt ? formatWebSavedTimestamp(target.lastLoginAt) ?? target.lastLoginAt : (th ? "ยังไม่เคยเข้าสู่ระบบ" : "Never")}</td>
              <td className="px-5 py-3.5"><div className="flex justify-end gap-2"><button type="button" onClick={() => { setEditingUserId(target.id); setDisplayNameDraft(target.displayName); }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:border-teal-500/60 hover:text-teal-300"><Pencil className="h-3.5 w-3.5" />{th ? "แก้ไข" : "Edit"}</button><button type="button" onClick={() => void active(target)} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${target.active ? "border-slate-700 text-slate-400 hover:border-amber-500/50 hover:text-amber-300" : "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"}`}>{target.active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}{target.active ? (th ? "ปิดใช้งาน" : "Disable") : (th ? "เปิดใช้งาน" : "Enable")}</button><button type="button" onClick={() => void remove(target)} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10"><Trash2 className="h-3.5 w-3.5" />{th ? "ลบ" : "Delete"}</button></div></td>
            </tr>)}
            {!loading && filteredUsers.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">{th ? "ไม่พบผู้ใช้ที่ตรงกับตัวกรอง" : "No users match the current filters."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-5 py-3 text-xs text-slate-500"><span>{loading ? (th ? "กำลังโหลดผู้ใช้…" : "Loading users…") : (th ? `แสดง ${filteredUsers.length} จาก ${users.length} ผู้ใช้` : `Showing ${filteredUsers.length} of ${users.length} users`)}</span><span>{th ? "การเปลี่ยนบทบาท/สถานะจะใช้กฎความปลอดภัยของระบบ" : "Role and status changes remain protected by server-side safeguards."}</span></div>
    </section>

    {message && <div role="status" className="rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">{message}</div>}
  </section>;
}
