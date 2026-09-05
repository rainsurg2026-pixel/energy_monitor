import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarRange, CheckCircle2, DatabaseBackup, Download, KeyRound, Palette, RefreshCw, ServerCog, ShieldCheck } from "lucide-react";
import { api } from "./api";
import type { AppLanguage, Theme } from "./theme";

export type SettingsDisplayPeriod = { startMonth: string; endMonth: string; rowVersion: number };
export type SettingsSite = { id: number; code: string; name: string };
type Tab = "personal" | "reporting" | "backup" | "security" | "system";

interface Props {
  lang: AppLanguage;
  displayPeriod: SettingsDisplayPeriod;
  isAdmin: boolean;
  theme: Theme;
  readOnlyMode: boolean;
  userId: string;
  userDisplayName: string;
  sites: SettingsSite[];
  onThemeChange: (theme: Theme) => void;
  onLanguageChange: (lang: AppLanguage) => void;
  onSaved: () => Promise<void>;
  onMessage: (message: string) => void;
}

const PASSWORD_MIN_LENGTH = 6;
export const defaultFacilityStorageKey = (userId: string) => `energy-monitor:default-facility:${userId}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed.";
const csrfToken = () => document.cookie.split(";").map(item => item.trim()).find(item => item.startsWith("em_csrf="))?.slice("em_csrf=".length);
function SectionTitle({ icon: Icon, title, detail }: { icon: typeof Palette; title: string; detail: string }) {
  return <div className="flex items-start gap-3"><div className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-2.5 text-teal-300"><Icon className="h-5 w-5" /></div><div><h3 className="font-display text-lg font-bold">{title}</h3><p className="mt-0.5 text-sm text-slate-400">{detail}</p></div></div>;
}

export default function ApplicationSettings(props: Props) {
  const { lang, displayPeriod, isAdmin, theme, readOnlyMode, userId, userDisplayName, sites, onThemeChange, onLanguageChange, onSaved, onMessage } = props;
  const th = lang === "th";
  const [tab, setTab] = useState<Tab>("personal");
  const [startMonth, setStartMonth] = useState(displayPeriod.startMonth);
  const [endMonth, setEndMonth] = useState(displayPeriod.endMonth);
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [health, setHealth] = useState<"checking" | "ready" | "error">("checking");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [defaultFacility, setDefaultFacility] = useState(() => { try { return localStorage.getItem(defaultFacilityStorageKey(userId)) ?? ""; } catch { return ""; } });
  useEffect(() => { setStartMonth(displayPeriod.startMonth); setEndMonth(displayPeriod.endMonth); }, [displayPeriod]);
  useEffect(() => { void api<{ status: string }>("/health/ready").then(() => setHealth("ready")).catch(() => setHealth("error")); }, []);

  const tabs = useMemo(() => [
    { id: "personal" as const, label: th ? "ส่วนตัว" : "Personal", icon: Palette },
    { id: "reporting" as const, label: th ? "รายงาน" : "Reporting", icon: CalendarRange },
    { id: "backup" as const, label: th ? "สำรองข้อมูล" : "Backup", icon: DatabaseBackup },
    { id: "security" as const, label: th ? "ความปลอดภัย" : "Security", icon: ShieldCheck },
    { id: "system" as const, label: th ? "ระบบ" : "System", icon: ServerCog }
  ], [th]);
  const savePeriod = async (event: FormEvent) => {
    event.preventDefault();
    if (startMonth > endMonth) { onMessage(th ? "เดือนเริ่มต้นต้องไม่เกินเดือนสิ้นสุด" : "Start month must be on or before end month."); return; }
    setBusy(true);
    try {
      await api("/settings/display-period", { method: "PUT", body: JSON.stringify({ start_month: startMonth, end_month: endMonth, expected_row_version: displayPeriod.rowVersion }) });
      await onSaved();
    } catch (error) { onMessage(errorMessage(error)); } finally { setBusy(false); }
  };

  const saveDefaultFacility = (value: string) => {
    setDefaultFacility(value);
    try { if (value) localStorage.setItem(defaultFacilityStorageKey(userId), value); else localStorage.removeItem(defaultFacilityStorageKey(userId)); } catch { /* keep in memory */ }
    onMessage(th ? "บันทึกไซต์เริ่มต้นแล้ว" : "Default facility saved.");
  };

  const exportDatabase = async () => {
    if (!window.confirm(th ? "ส่งออกข้อมูลฐานข้อมูลทั้งหมดที่อนุญาตสำหรับการสำรองข้อมูลหรือไม่? ข้อมูลรหัสผ่าน เซสชัน และ secret จะไม่ถูกรวม" : "Export the complete safe database backup? Password credentials, sessions, OAuth tokens/state, and secrets will be excluded.")) return;
    setBackupBusy(true);
    try {
      const headers = new Headers(); const csrf = csrfToken(); if (csrf) headers.set("x-csrf-token", decodeURIComponent(csrf));
      const response = await fetch("/api/v1/admin/database-backup", { method: "POST", headers, credentials: "include" });
      if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(payload?.error?.message ?? `Backup export failed (${response.status}).`); }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/i)?.[1] ?? "EnergyMonitor_Database_Backup.zip";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onMessage(th ? "สร้างไฟล์สำรองฐานข้อมูลแล้ว" : "Database backup created.");
    } catch (error) { onMessage(errorMessage(error)); } finally { setBackupBusy(false); }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword.length < PASSWORD_MIN_LENGTH) { onMessage(th ? `รหัสผ่านใหม่ต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` : `New password must contain at least ${PASSWORD_MIN_LENGTH} characters.`); return; }
    if (newPassword !== confirmPassword) { onMessage(th ? "รหัสผ่านใหม่ไม่ตรงกัน" : "New password confirmation does not match."); return; }
    setBusy(true);
    try {
      await api("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      onMessage(th ? "เปลี่ยนรหัสผ่านแล้ว" : "Password changed.");
    } catch (error) { onMessage(errorMessage(error)); } finally { setBusy(false); }
  };

  const environmentLabel = readOnlyMode ? (th ? "Preview · Production data แบบอ่านอย่างเดียว" : "Preview · Production data read-only") : "Production / Direct runtime";
  const activeTab = tabs.find(item => item.id === tab)!;
  return <section className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="font-display text-2xl font-bold">{th ? "ตั้งค่าแอปพลิเคชัน" : "Application Settings"}</h2><p className="mt-1 text-sm text-slate-400">{th ? "จัดการการแสดงผล รายงาน การสำรองข้อมูล ความปลอดภัย และข้อมูลระบบจากจุดเดียว" : "Manage appearance, reporting, backups, security, and system information from one workspace."}</p></div>
      <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-400"><span className="block uppercase tracking-wider">{th ? "บัญชี" : "Account"}</span><b className="text-sm text-slate-200">{userDisplayName}</b></div>
    </div>
    <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 p-2 md:flex-col" aria-label={th ? "หมวดการตั้งค่า" : "Settings sections"}>
        {tabs.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex min-w-max items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${tab === item.id ? "bg-teal-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}
      </nav>
      <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-5 md:p-6">
        <div className="mb-5 border-b border-slate-800 pb-4"><span className="text-xs uppercase tracking-wider text-slate-500">{th ? "การตั้งค่า" : "Settings"}</span><h3 className="mt-1 font-display text-xl font-bold">{activeTab.label}</h3></div>

        {tab === "personal" && <div className="space-y-6">
          <SectionTitle icon={Palette} title={th ? "รูปแบบส่วนตัว" : "Personal Preferences"} detail={th ? "มีผลเฉพาะบัญชีและเบราว์เซอร์นี้" : "Applies to this account and browser."} />
          <div><p className="mb-2 text-sm font-semibold">{th ? "ธีม" : "Theme"}</p><div className="grid gap-3 sm:grid-cols-2">{(["light", "dark"] as Theme[]).map(value => <button key={value} type="button" onClick={() => onThemeChange(value)} className={`rounded-xl border p-4 text-left ${theme === value ? "border-teal-400 bg-teal-500/10" : "border-slate-700 bg-slate-950/40"}`}><b>{value === "light" ? (th ? "สว่าง" : "Light") : (th ? "มืด" : "Dark")}</b><span className="mt-1 block text-xs text-slate-400">{value === "light" ? (th ? "พื้นที่ทำงานโทนสว่าง" : "Light workspace") : (th ? "พื้นที่ทำงานโทนน้ำเงินเข้ม" : "Deep navy workspace")}</span></button>)}</div></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">{th ? "ภาษา" : "Language"}<select value={lang} onChange={event => onLanguageChange(event.target.value as AppLanguage)} className="mt-2 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5"><option value="en">English</option><option value="th">ไทย</option></select></label>
            <label className="text-sm font-semibold">{th ? "ไซต์เริ่มต้น" : "Default facility"}<select value={defaultFacility} onChange={event => saveDefaultFacility(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5"><option value="">{th ? "ใช้ไซต์ล่าสุด" : "Use last selected facility"}</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name} ({site.code})</option>)}</select></label>
          </div>
        </div>}

        {tab === "reporting" && <div className="space-y-6">
          <SectionTitle icon={CalendarRange} title={th ? "รายงานและช่วงข้อมูล" : "Reporting & Display"} detail={th ? "กำหนดช่วงข้อมูลส่วนกลางและกติกาการ Export" : "Control the global display period and report/export rules."} />
          {isAdmin ? <form onSubmit={savePeriod} className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <h4 className="font-semibold">Global Display Period</h4>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">{th ? "เดือนเริ่มต้น" : "Start month"}<input type="month" required value={startMonth} onChange={event => setStartMonth(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5" /></label>
              <label className="text-sm">{th ? "เดือนสิ้นสุด" : "End month"}<input type="month" required value={endMonth} onChange={event => setEndMonth(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5" /></label>
            </div>
            <button disabled={busy || readOnlyMode} className="mt-4 rounded-xl bg-teal-500 px-4 py-2.5 font-semibold text-slate-950 disabled:opacity-50">{busy ? (th ? "กำลังบันทึก…" : "Saving…") : (th ? "บันทึกช่วงข้อมูล" : "Save Display Period")}</button>
            {readOnlyMode && <p className="mt-2 text-xs text-amber-300">{th ? "Preview ใช้ Production data แบบอ่านอย่างเดียว จึงไม่อนุญาตให้แก้ Global Display Period" : "Preview uses Production data read-only, so Global Display Period changes are disabled."}</p>}
          </form> : <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">{displayPeriod.startMonth} → {displayPeriod.endMonth}</div>}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800 p-4"><b>{th ? "ช่วงกราฟ" : "Trend scope"}</b><p className="mt-1 text-sm text-slate-400">{th ? "รายงานหลายเดือน: กราฟตาม Quick Period · รายงาน 1 เดือน: กราฟย้อนหลัง 12 เดือน" : "Multi-month reports follow Quick Period. Single-month reports show a trailing 12-month trend."}</p></div>
            <div className="rounded-xl border border-slate-800 p-4"><b>{th ? "เวลาและชื่อไฟล์" : "Time & filenames"}</b><p className="mt-1 text-sm text-slate-400">dd-Mmm-yyyy; HH:mm · GMT+7 / Asia/Bangkok<br />Current Facility: DC_Status_MonthlyReport of RST/SNK_Mmm-YYYY</p></div>
          </div>
        </div>}

        {tab === "backup" && <div className="space-y-6">
          <SectionTitle icon={DatabaseBackup} title={th ? "สำรองข้อมูลและจัดการข้อมูล" : "Backup & Data Management"} detail={th ? "สร้าง Logical Backup ของฐานข้อมูลเพื่อเก็บไว้นอกระบบ" : "Create a portable logical backup of the application database."} />
          {isAdmin ? <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><h4 className="font-semibold">Export all database</h4><p className="mt-2 text-sm leading-relaxed text-slate-400">{th ? "ดาวน์โหลด ZIP ที่บรรจุข้อมูล Operational, Configuration, Audit และข้อมูลผู้ใช้ที่ไม่เป็นความลับเป็น CSV พร้อม manifest.json" : "Downloads a ZIP containing operational, configuration, audit, and non-secret user metadata as CSV files plus manifest.json."}</p><p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">{th ? "ไม่รวม password hash, session, OAuth token/state, rate-limit data, server secret และไฟล์รูปใน object storage" : "Excludes password hashes, sessions, OAuth token/state, rate-limit data, server secrets, and object-storage image bytes."}</p></div>
              <button type="button" disabled={backupBusy || readOnlyMode} onClick={() => void exportDatabase()} className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"><Download className="h-4 w-4" />{backupBusy ? (th ? "กำลังสร้าง…" : "Preparing…") : "Export all database"}</button>
            </div>
            {readOnlyMode && <p className="mt-3 text-xs text-amber-300">{th ? "เพื่อป้องกัน Production database ปุ่มนี้จะเปิดใช้งานเมื่อ version นี้ถูก Promote เข้า Production" : "For Production database safety, this control becomes active after this version is promoted to Production."}</p>}
          </div> : <div className="rounded-xl border border-slate-800 p-4 text-sm text-slate-400">{th ? "เฉพาะ Admin เท่านั้นที่ส่งออกฐานข้อมูลได้" : "Only Admin users can export a database backup."}</div>}
        </div>}
        {tab === "security" && <div className="space-y-6">
          <SectionTitle icon={ShieldCheck} title={th ? "ความปลอดภัยและการเข้าถึง" : "Security & Access"} detail={th ? "จัดการรหัสผ่านของบัญชีปัจจุบัน" : "Manage security for the current account."} />
          <form onSubmit={changePassword} className="max-w-2xl rounded-xl border border-slate-800 bg-slate-950/40 p-5">
            <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-teal-300" /><h4 className="font-semibold">{th ? "เปลี่ยนรหัสผ่าน" : "Change my password"}</h4></div>
            <div className="mt-4 grid gap-3"><input type="password" required placeholder={th ? "รหัสผ่านปัจจุบัน" : "Current password"} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5" /><input type="password" required placeholder={th ? "รหัสผ่านใหม่" : "New password"} value={newPassword} onChange={event => setNewPassword(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5" /><input type="password" required placeholder={th ? "ยืนยันรหัสผ่านใหม่" : "Confirm new password"} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5" /></div>
            <button disabled={busy || readOnlyMode} className="mt-4 rounded-xl border border-teal-500/60 px-4 py-2.5 font-semibold text-teal-300 disabled:opacity-50">{th ? "เปลี่ยนรหัสผ่าน" : "Change password"}</button>
            {readOnlyMode && <p className="mt-2 text-xs text-amber-300">{th ? "Preview ไม่อนุญาตให้เปลี่ยนข้อมูลบัญชี Production" : "Preview cannot change Production account data."}</p>}
          </form>
        </div>}

        {tab === "system" && <div className="space-y-6">
          <SectionTitle icon={ServerCog} title={th ? "ข้อมูลระบบ" : "System Information"} detail={th ? "ใช้สำหรับตรวจสอบ environment และการทำงานของระบบ" : "Operational details for support and environment verification."} />
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-800 p-4"><span className="text-xs uppercase text-slate-500">Environment</span><b className="mt-1 block">{environmentLabel}</b></div><div className="rounded-xl border border-slate-800 p-4"><span className="text-xs uppercase text-slate-500">Data source</span><b className="mt-1 block">{readOnlyMode ? "Production API · Read-only bridge" : "PostgreSQL · Direct runtime"}</b></div><div className="rounded-xl border border-slate-800 p-4"><span className="text-xs uppercase text-slate-500">PDF engine</span><b className="mt-1 block">Server-side Chromium</b></div><div className="rounded-xl border border-slate-800 p-4"><span className="text-xs uppercase text-slate-500">Time zone</span><b className="mt-1 block">GMT+7 · Asia/Bangkok</b></div></div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex items-center gap-2">{health === "ready" ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <RefreshCw className={`h-5 w-5 ${health === "checking" ? "animate-spin" : "text-rose-400"}`} />}<div><b>{th ? "สถานะ API" : "API health"}</b><p className="text-xs text-slate-400">{health === "ready" ? "READY" : health === "checking" ? "Checking…" : "Unavailable"}</p></div></div><button type="button" onClick={() => { setHealth("checking"); void api("/health/ready").then(() => setHealth("ready")).catch(() => setHealth("error")); }} className="rounded-lg border border-slate-700 px-3 py-2 text-xs"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Refresh</button></div>
        </div>}
      </div>
    </div>
  </section>;
}
