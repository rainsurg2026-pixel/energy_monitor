import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Activity, Boxes, Calculator, ChartNoAxesCombined, Database, Gauge, LogOut, RefreshCw, Settings, Table2, Zap } from "lucide-react";
import { Line, LineChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiRequest, ApiError, type SessionUser } from "./apiClient";

interface SiteState { site: { id: number; code: string; name: string; active: boolean }; availableMonths: string[]; latestAvailableMonth: string | null; }
interface BootstrapState { formulaVersion: string; displayPeriod: { startMonth: string; endMonth: string; rowVersion: number }; allowedMonths: string[]; availableMonths: string[]; latestAvailableMonth: string | null; sites: SiteState[]; readOnlyMode?: boolean; }
interface Calculation { buildingEnergyKwh: number | null; buildingElectricityCostThb: number | null; upsEnergyKwh: number | null; airEnergyKwh: number | null; dcEnergyKwh: number | null; floorEnergyKwh: number | null; floorElectricityCostThb: number | null; averageElectricityRateThbPerKwh: number | null; energySharePercent: number | null; }

function formatNumber(value: unknown, digits = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value);
}

function LoginView({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiRequest<{ user: SessionUser }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      setPassword("");
      onAuthenticated(result.user);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 423) setError("บัญชีถูกระงับชั่วคราว กรุณาลองใหม่ภายหลัง");
      else if (cause instanceof ApiError && cause.status === 429) setError("มีการพยายามเข้าสู่ระบบมากเกินไป กรุณาลองใหม่ภายหลัง");
      else setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    } finally {
      setBusy(false);
    }
  };

  return <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
    <form onSubmit={submit} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-7 shadow-2xl space-y-5">
      <div><p className="text-[11px] uppercase tracking-[0.2em] text-indigo-400 font-bold">Energy Monitor Web v3</p><h1 className="text-2xl font-semibold mt-2">เข้าสู่ระบบ</h1><p className="text-sm text-slate-400 mt-2">ใช้ Username และ Password ของระบบงานเท่านั้น</p></div>
      <label className="block space-y-1.5"><span className="text-xs text-slate-400 font-semibold">Username</span><input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500" required /></label>
      <label className="block space-y-1.5"><span className="text-xs text-slate-400 font-semibold">Password</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 outline-none focus:border-indigo-500" required /></label>
      {error && <p role="alert" className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 font-semibold">{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button>
    </form>
  </main>;
}

function MetricCard({ label, value, unit }: { label: string; value: unknown; unit?: string }) {
  return <article className="bg-slate-900 border border-slate-800 rounded-2xl p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold mt-2">{formatNumber(value)}</p>{unit && <p className="text-xs text-slate-500 mt-1">{unit}</p>}</article>;
}

function EmptyState({ message = "ยังไม่มีข้อมูลในช่วงที่เลือก" }: { message?: string }) {
  return <section className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400"><Database className="mx-auto mb-3 w-8 h-8 text-slate-600" /><p>{message}</p></section>;
}

function LoadingState() { return <section className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400"><RefreshCw className="mx-auto mb-3 w-8 h-8 animate-spin text-indigo-400" /><p>กำลังโหลดข้อมูล…</p></section>; }

interface MonthlyLogResponse { siteId: number; month: string; rowVersion: number | null; log: any | null; calculation: Calculation | null; }

function rawEditorLog(log: any): any {
  return {
    month: log.month,
    ups: log.ups ?? [],
    air: log.air ?? { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} },
    dc: log.dc ?? [],
    energyCost: {
      buildingEnergyKwh: log.energyCost?.buildingEnergyKwh ?? null,
      buildingElectricityCostThb: log.energyCost?.buildingElectricityCostThb ?? null
    },
    ...(log.energyCalculation ? { energyCalculation: log.energyCalculation } : {}),
    ...(log.srinakarinInputs ? { srinakarinInputs: log.srinakarinInputs } : {})
  };
}

function emptyEditorLog(month: string): any {
  return { month, ups: [], air: { eb41a: null, eb41b: null, eb42a: null, eb42b: null, meters: {} }, dc: [], energyCost: { buildingEnergyKwh: null, buildingElectricityCostThb: null } };
}

function editorError(cause: unknown): string {
  if (!(cause instanceof ApiError)) return "ไม่สามารถบันทึกข้อมูลได้";
  if (cause.status === 400) return `ข้อมูลไม่ถูกต้อง: ${cause.message}`;
  if (cause.status === 401) return "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่";
  if (cause.status === 403) return "ไม่มีสิทธิ์แก้ไขข้อมูลชุดนี้";
  if (cause.status === 409) return "ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดค่าล่าสุดก่อนบันทึกอีกครั้ง";
  if (cause.status === 423) return "READ_ONLY_MODE: ระบบอยู่ในโหมดอ่านข้อมูลเท่านั้น";
  if (cause.status === 429) return "มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง";
  if (cause.status >= 500) return "ระบบปลายทางไม่พร้อม กรุณาลองใหม่ภายหลัง";
  return cause.message || "ไม่สามารถบันทึกข้อมูลได้";
}

function OperationalEditor({ siteId, month, readOnly, onDirty, onSaved }: { siteId: number; month: string; readOnly: boolean; onDirty: (dirty: boolean) => void; onSaved: () => void }) {
  const [data, setData] = useState<MonthlyLogResponse | null>(null);
  const [rawText, setRawText] = useState("");
  const [initialText, setInitialText] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"Idle" | "Saving" | "Saved" | "Error">("Idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!siteId || !month) { setData(null); setRawText(""); setInitialText(""); onDirty(false); return; }
    setLoading(true); setError(null);
    try {
      const result = await apiRequest<MonthlyLogResponse>(`/sites/${siteId}/periods/${encodeURIComponent(month)}`);
      const nextText = JSON.stringify(result.log ? rawEditorLog(result.log) : emptyEditorLog(month), null, 2);
      setData(result); setRawText(nextText); setInitialText(nextText); onDirty(false); setStatus("Idle");
    } catch (cause) { setData(null); setError(editorError(cause)); } finally { setLoading(false); }
  }, [month, onDirty, siteId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onDirty(Boolean(rawText) && rawText !== initialText); }, [initialText, onDirty, rawText]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || status === "Saving" || !data) return;
    let log: unknown;
    try { log = JSON.parse(rawText); } catch { setStatus("Error"); setError("Raw input JSON ไม่ถูกต้อง"); return; }
    setStatus("Saving"); setError(null);
    try {
      await apiRequest(`/sites/${siteId}/periods/${encodeURIComponent(month)}`, {
        method: "PUT",
        body: JSON.stringify({ log, expected_row_version: data.rowVersion, provenance: { source_type: "web-api", source_location: `site:${siteId}/month:${month}` } })
      });
      setStatus("Saved");
      await load();
      onSaved();
    } catch (cause) { setStatus("Error"); setError(editorError(cause)); }
  };

  if (!siteId || !month) return null;
  return <section className="mt-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4" data-testid="operational-editor">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Operational write</p><h2 className="text-xl font-semibold mt-1">Raw inputs — {month}</h2><p className="text-xs text-slate-500 mt-1">แก้ไขเฉพาะ raw inputs; ค่าพลังงาน/ค่าใช้จ่าย derived คำนวณใหม่จาก domain layer หลังบันทึก</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status === "Error" ? "bg-rose-500/15 text-rose-300" : status === "Saving" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>{status}</span></div>
    {readOnly && <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">READ_ONLY_MODE: operational writes are disabled by the server.</p>}
    {loading && <p className="text-sm text-slate-400">กำลังโหลด raw inputs…</p>}
    {error && <div role="alert" className="text-sm text-rose-200 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3"><span>{error}</span>{status === "Error" && <button type="button" onClick={() => void load()} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold">โหลดค่าล่าสุด</button>}</div>}
    {!loading && data && <form onSubmit={save} className="space-y-3"><textarea aria-label="Raw operational inputs" value={rawText} onChange={event => { setRawText(event.target.value); setStatus("Idle"); }} disabled={readOnly || status === "Saving"} spellCheck={false} className="w-full min-h-80 bg-slate-950 border border-slate-700 rounded-xl p-3 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500 disabled:opacity-60" /><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">row_version: {data.rowVersion ?? "new"} · null และ 0 จะถูกเก็บตามความหมายเดิม</p><button type="submit" disabled={readOnly || status === "Saving" || rawText === initialText} className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-semibold">{status === "Saving" ? "กำลังบันทึก…" : "บันทึก raw inputs"}</button></div></form>}
    {!loading && !data && !error && <p className="text-sm text-slate-400">ยังไม่มี monthly dataset สำหรับช่วงนี้</p>}
    {data?.calculation && <details className="text-sm"><summary className="cursor-pointer font-semibold text-slate-300">Derived calculation (read-only)</summary><div className="mt-3"><CalculationCards calculation={data.calculation} /></div></details>}
  </section>;
}

function Shell({ user, bootstrap, route, onNavigate, onLogout, children }: { user: SessionUser; bootstrap: BootstrapState; route: string; onNavigate: (path: string) => void; onLogout: () => Promise<void>; children: ReactNode }) {
  const links = [
    ["/dashboard", "Dashboard", Gauge], ["/energy", "Energy", Zap], ["/cost", "Cost", Calculator], ["/electrical", "Electrical", Activity], ["/site-comparison", "Site Comparison", ChartNoAxesCombined], ["/racks", "Racks", Boxes], ["/rack-units", "Rack Units", Table2]
  ] as const;
  return <div className="min-h-screen bg-slate-950 text-slate-100">
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur"><div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex flex-wrap items-center gap-4 justify-between">
      <div><p className="text-[11px] uppercase tracking-[0.2em] text-indigo-400 font-bold">Energy Monitor</p><p className="text-lg font-semibold mt-1">Web v3</p></div>
      <div className="flex items-center gap-3 text-sm"><span className="text-slate-400">{user.displayName}</span><span className="rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-2.5 py-1 text-xs font-bold">{user.role}</span><button onClick={() => void onLogout()} className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-semibold"><LogOut className="w-3.5 h-3.5" /> ออกจากระบบ</button></div>
    </div><nav aria-label="Application" className="max-w-7xl mx-auto px-4 md:px-6 pb-3 flex flex-wrap gap-2">{links.map(([path, label, Icon]) => <a key={path} href={path} onClick={event => { event.preventDefault(); onNavigate(path); }} className={`rounded-xl px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5 ${route === path ? "bg-indigo-600" : "bg-slate-800 hover:bg-slate-700"}`}><Icon className="w-3.5 h-3.5" />{label}</a>)}<a href="/settings" onClick={event => { event.preventDefault(); onNavigate("/settings"); }} className="rounded-xl bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-semibold inline-flex items-center gap-1.5"><Settings className="w-3.5 h-3.5" /> Settings</a></nav></header>
    {bootstrap.readOnlyMode && <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-200 px-4 py-2 text-center text-xs font-semibold">READ_ONLY_MODE: ระบบอยู่ในโหมดอ่านข้อมูลเท่านั้น</div>}
    <main className="max-w-7xl mx-auto px-4 md:px-6 py-6">{children}</main>
  </div>;
}

function ScopeBar({ bootstrap, siteId, month, onSiteChange, onMonthChange }: { bootstrap: BootstrapState; siteId: number; month: string; onSiteChange: (id: number) => void; onMonthChange: (month: string) => void }) {
  const site = bootstrap.sites.find(item => item.site.id === siteId) ?? bootstrap.sites[0];
  const months = site?.availableMonths ?? bootstrap.availableMonths;
  return <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-wrap gap-3 items-end"><label className="space-y-1"><span className="block text-xs text-slate-500">Site</span><select value={siteId} onChange={event => onSiteChange(Number(event.target.value))} className="field"><option value={0}>—</option>{bootstrap.sites.map(item => <option key={item.site.id} value={item.site.id}>{item.site.name}</option>)}</select></label><label className="space-y-1"><span className="block text-xs text-slate-500">Month</span><select value={month} onChange={event => onMonthChange(event.target.value)} className="field"><option value="">—</option>{months.map(item => <option key={item} value={item}>{item}</option>)}</select></label><p className="text-xs text-slate-500 pb-2">Global Display Period: {bootstrap.displayPeriod.startMonth} → {bootstrap.displayPeriod.endMonth}</p></div>;
}

function CalculationCards({ calculation }: { calculation: Calculation }) {
  return <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Building Energy" value={calculation.buildingEnergyKwh} unit="kWh" /><MetricCard label="Floor Energy" value={calculation.floorEnergyKwh} unit="kWh" /><MetricCard label="Floor Cost" value={calculation.floorElectricityCostThb} unit="THB" /><MetricCard label="Average Rate" value={calculation.averageElectricityRateThbPerKwh} unit="THB/kWh" /><MetricCard label="UPS Energy" value={calculation.upsEnergyKwh} unit="kWh" /><MetricCard label="Air Energy" value={calculation.airEnergyKwh} unit="kWh" /><MetricCard label="DC Energy" value={calculation.dcEnergyKwh} unit="kWh" /><MetricCard label="Energy Share" value={calculation.energySharePercent} unit="%" /></div>;
}

function ReadDataPage({ kind, siteId, month, refreshKey = 0 }: { kind: "dashboard" | "energy" | "cost" | "electrical" | "racks" | "rack-units"; siteId: number; month: string; refreshKey?: number }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!siteId || (kind !== "dashboard" && !month)) { setData(null); return; }
    const endpoint = kind === "dashboard" ? `/dashboard?siteId=${siteId}${month ? `&month=${encodeURIComponent(month)}` : ""}` : `/${kind}?siteId=${siteId}&month=${encodeURIComponent(month)}`;
    setLoading(true); setError(null);
    void apiRequest<any>(endpoint).then(setData).catch(cause => setError(cause instanceof ApiError && cause.status === 404 ? "ช่วงเวลานี้ไม่อยู่ใน Global Display Period หรือยังไม่มีข้อมูล" : "ไม่สามารถโหลดข้อมูลจาก API ได้")).finally(() => setLoading(false));
  }, [kind, month, refreshKey, siteId]);
  if (loading) return <LoadingState />;
  if (error) return <section role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5">{error}</section>;
  if (!data) return <EmptyState />;
  if (kind === "dashboard" || kind === "energy") return <div className="space-y-5"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">{kind === "dashboard" ? "Dashboard" : "Energy"}</p><h1 className="text-3xl font-semibold mt-2">{data.month ?? data.selectedMonth ?? month}</h1><p className="text-xs text-slate-500 mt-1">Formula: {data.formulaVersion ?? data.energy?.formulaVersion ?? "desktop-v2.3.1"}</p></div><CalculationCards calculation={(data.calculation ?? data.energy?.calculation) as Calculation} /></div>;
  if (kind === "cost") { const derived = data.derived ?? {}; return <div className="space-y-5"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Cost</p><h1 className="text-3xl font-semibold mt-2">{data.month}</h1></div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Building Cost" value={data.building?.costThb} unit="THB" /><MetricCard label="Floor Cost" value={derived.floorElectricityCostThb} unit="THB" /><MetricCard label="Average Rate" value={derived.averageElectricityRateThbPerKwh} unit="THB/kWh" /><MetricCard label="Energy Share" value={derived.energySharePercent} unit="%" /></div></div>; }
  if (kind === "electrical") return <div className="space-y-5"><h1 className="text-3xl font-semibold">Electrical — {data.month}</h1><div className="grid md:grid-cols-3 gap-4"><article className="panel"><h2 className="font-semibold">UPS</h2><p className="text-2xl mt-3">{data.ups?.length ?? 0}</p><p className="text-xs text-slate-500">records</p></article><article className="panel"><h2 className="font-semibold">Air</h2><p className="text-sm mt-3 text-slate-300">{data.air ? "Available" : "No data"}</p></article><article className="panel"><h2 className="font-semibold">DC</h2><p className="text-2xl mt-3">{data.dc?.length ?? 0}</p><p className="text-xs text-slate-500">panels</p></article></div><details className="panel"><summary className="cursor-pointer font-semibold">Raw API output</summary><pre className="mt-3 overflow-auto text-xs text-slate-400">{JSON.stringify({ ups: data.ups, air: data.air, dc: data.dc }, null, 2)}</pre></details></div>;
  if (kind === "racks") { const metrics = data.snapshot?.metrics; return <div className="space-y-5"><h1 className="text-3xl font-semibold">Racks — {data.month}</h1>{data.snapshot ? <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Total Racks" value={metrics?.total} /><MetricCard label="In Use" value={metrics?.inUse?.count} /><MetricCard label="Available" value={metrics?.available?.count} /><MetricCard label="In Use" value={typeof metrics?.inUse?.ratio === "number" ? metrics.inUse.ratio * 100 : null} unit="%" /></div> : <EmptyState />}</div>; }
  const rackUnit = data.snapshot; return <div className="space-y-5"><h1 className="text-3xl font-semibold">Rack Unit Capacity — {data.month}</h1>{rackUnit ? <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><MetricCard label="Total U" value={rackUnit.totalU} unit="U" /><MetricCard label="Used U" value={rackUnit.usedU} unit="U" /><MetricCard label="Available U" value={rackUnit.availableU} unit="U" /><MetricCard label="Usage" value={rackUnit.usagePercent} unit="%" /></div> : <EmptyState />}</div>;
}

function SiteComparisonPage() {
  const [data, setData] = useState<any>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void apiRequest<any>("/site-comparison").then(setData).catch(() => setError("ไม่สามารถโหลด Site Comparison ได้")); }, []);
  if (error) return <section role="alert" className="bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-2xl p-5">{error}</section>;
  if (!data) return <LoadingState />;
  if (!data.months?.length) return <EmptyState />;
  const chartData = data.months.map((month: string) => Object.fromEntries([
    ["month", month],
    ...data.sites.map((site: any) => [site.site.code, site.months.find((entry: any) => entry.month === month)?.metrics?.buildingEnergy ?? null])
  ]));
  const chartMinWidth = Math.max(640, data.months.length * 76);
  return <div className="space-y-5"><div><p className="text-xs uppercase tracking-[0.2em] text-indigo-400 font-bold">Site Comparison</p><h1 className="text-3xl font-semibold mt-2">{data.displayPeriod.startMonth} → {data.displayPeriod.endMonth}</h1><p className="text-xs text-slate-500 mt-1">เฉพาะเดือนที่ backend อนุญาตและมีข้อมูล</p></div><div className="overflow-x-auto overflow-y-hidden overscroll-x-contain panel"><div style={{ minWidth: chartMinWidth }} className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><XAxis dataKey="month" /><YAxis /><Tooltip /><Legend />{data.sites.map((site: any, index: number) => <Line key={site.site.id} type="monotone" dataKey={site.site.code} name={site.site.name} stroke={index % 2 === 0 ? "#60a5fa" : "#fb7185"} connectNulls={false} />)}</LineChart></ResponsiveContainer></div></div><div className="overflow-x-auto panel"><table className="min-w-[760px] w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-2 pr-4">Site</th>{data.months.map((item: string) => <th key={item} className="py-2 px-3">{item}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{data.sites.map((site: any) => <tr key={site.site.id}><td className="py-3 pr-4 font-semibold">{site.site.name}</td>{data.months.map((item: string) => <td key={item} className="py-3 px-3 text-slate-400">{site.months.find((entry: any) => entry.month === item)?.metrics?.buildingEnergy === null ? "—" : formatNumber(site.months.find((entry: any) => entry.month === item)?.metrics?.buildingEnergy)}</td>)}</tr>)}</tbody></table></div></div>;
}

export default function WebV3App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapState | null>(null);
  const initialPath = window.location.pathname.replace(/\/+$/, "") || "/dashboard";
  const [route, setRoute] = useState(initialPath === "/" ? "/dashboard" : initialPath);
  const [siteId, setSiteId] = useState(0);
  const [month, setMonth] = useState("");
  const [formDirty, setFormDirty] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const canLeaveForm = useCallback(() => !formDirty || window.confirm("มีการแก้ไข raw inputs ที่ยังไม่บันทึก ต้องการออกจากหน้านี้หรือไม่?"), [formDirty]);
  const navigate = useCallback((path: string) => { if (!canLeaveForm()) return; window.history.pushState({}, "", path); setRoute(path); setFormDirty(false); }, [canLeaveForm]);

  useEffect(() => { if (window.location.pathname === "/") window.history.replaceState({}, "", "/dashboard"); const handler = () => setRoute(window.location.pathname.replace(/\/+$/, "") || "/dashboard"); window.addEventListener("popstate", handler); return () => window.removeEventListener("popstate", handler); }, []);
  useEffect(() => { void apiRequest<{ authenticated: boolean; user: SessionUser | null }>("/auth/session").then(result => setUser(result.authenticated ? result.user : null)).catch(() => setUser(null)); }, []);
  useEffect(() => { if (!user) { setBootstrap(null); return; } void apiRequest<BootstrapState>("/bootstrap").then(result => { setBootstrap(result); const first = result.sites[0]; setSiteId(current => current || first?.site.id || 0); setMonth(current => current || first?.latestAvailableMonth || result.latestAvailableMonth || ""); }).catch(() => setBootstrap(null)); }, [user]);
  const selectedSite = useMemo(() => bootstrap?.sites.find(item => item.site.id === siteId) ?? bootstrap?.sites[0], [bootstrap, siteId]);
  useEffect(() => { const available = selectedSite?.availableMonths ?? []; if (month && available.length > 0 && !available.includes(month)) setMonth(selectedSite?.latestAvailableMonth ?? bootstrap?.latestAvailableMonth ?? ""); }, [bootstrap, month, selectedSite]);
  const logout = async () => { try { await apiRequest("/auth/logout", { method: "POST" }); } finally { setUser(null); setBootstrap(null); } };
  if (!user) return <LoginView onAuthenticated={setUser} />;
  if (!bootstrap) return <LoadingState />;
  const needsScope = ["/dashboard", "/energy", "/cost", "/electrical", "/racks", "/rack-units"].includes(route);
  const selectedKind = (route.slice(1) || "dashboard") as "dashboard" | "energy" | "cost" | "electrical" | "racks" | "rack-units";
  const editableRoute = ["/energy", "/electrical", "/cost"].includes(route);
  return <Shell user={user} bootstrap={bootstrap} route={route} onNavigate={navigate} onLogout={logout}>{needsScope && <ScopeBar bootstrap={bootstrap} siteId={siteId} month={month} onSiteChange={id => { if (!canLeaveForm()) return; setSiteId(id); const next = bootstrap.sites.find(item => item.site.id === id)?.latestAvailableMonth; if (next) setMonth(next); setFormDirty(false); }} onMonthChange={nextMonth => { if (!canLeaveForm()) return; setMonth(nextMonth); setFormDirty(false); }} />}{needsScope && <div className="mt-5"><ReadDataPage kind={selectedKind} siteId={selectedSite?.site.id ?? siteId} month={month} refreshKey={refreshKey} />{editableRoute && <OperationalEditor siteId={selectedSite?.site.id ?? siteId} month={month} readOnly={Boolean(bootstrap.readOnlyMode)} onDirty={setFormDirty} onSaved={() => setRefreshKey(value => value + 1)} />}</div>}{route === "/site-comparison" && <SiteComparisonPage />}{!needsScope && route !== "/site-comparison" && <EmptyState message="เลือกเมนูจากแถบด้านบน" />}</Shell>;
}
