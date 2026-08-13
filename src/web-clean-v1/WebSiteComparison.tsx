import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Coins, Gauge, RefreshCw, Server, TrendingUp } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { api } from "./api";
import type { ComparisonMetric, RackSnapshotApiResponse, SiteComparisonExport } from "./exports";

type RackUnitSnapshot = { totalU: number; usedU: number; availableU: number; usagePercent: number | null };
type RackSnapshot = NonNullable<RackSnapshotApiResponse["snapshot"]>;
type RackState = { rack: RackSnapshot | null; unit: RackUnitSnapshot | null; unavailable: boolean };

const siteColour = (index: number) => index % 2 === 0 ? "#e87959" : "#5b8db8";
const metric = (value: number | null | undefined, suffix = "") => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${formatNumber2(value)}${suffix}`;

function rackCounts(snapshot: RackSnapshot | null) {
  const records = snapshot?.records ?? [];
  return {
    total: records.length,
    inUse: records.filter(record => /^in\s*use$/i.test(record.status ?? "")).length,
    available: records.filter(record => /^available$/i.test(record.status ?? "")).length,
    reserved: records.filter(record => /^reserved$/i.test(record.status ?? "")).length
  };
}

function TrendCard({ title, icon, data, sites, suffix, unit }: {
  title: string;
  icon: React.ReactNode;
  data: Array<Record<string, string | number | null>>;
  sites: SiteComparisonExport["sites"];
  suffix: "energy" | "cost";
  unit: string;
}) {
  return <section className="h-80 rounded-xl border border-slate-800 bg-slate-900 p-4">
    <h3 className="mb-3 flex items-center gap-2 font-semibold">{icon}{title}</h3>
    <ResponsiveContainer width="100%" height="90%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip formatter={(value: number | string | undefined) => value === null || value === undefined ? "—" : `${formatNumber2(Number(value))} ${unit}`} />
        <Legend />
        {sites.map((site, index) => <Line key={`${site.site.id}-${suffix}`} type="monotone" dataKey={`${site.site.code}-${suffix}`} name={site.site.name} stroke={siteColour(index)} connectNulls={false} />)}
      </LineChart>
    </ResponsiveContainer>
  </section>;
}

/** Web counterpart of Desktop FacilityComparison.
 *
 * Comparison metrics come from the server's shared calculation. Rack and U
 * capacity are fetched per selected facility/month, never copied from the
 * currently selected facility. Missing snapshots remain visibly missing.
 */
export default function WebSiteComparison({ lang = "th" }: { lang?: "th" | "en" }) {
  const th = lang === "th";
  const [data, setData] = useState<SiteComparisonExport | null>(null);
  const [referenceMonth, setReferenceMonth] = useState("");
  const [range, setRange] = useState<3 | 6 | 12>(12);
  const [error, setError] = useState<string | null>(null);
  const [rackState, setRackState] = useState<Record<number, RackState>>({});
  const [rackLoading, setRackLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<SiteComparisonExport>("/site-comparison");
      const common = result.months.filter(month => result.sites.every(site => site.months.some(entry => entry.month === month && entry.metrics)));
      setData(result);
      setReferenceMonth(current => current && result.months.includes(current) ? current : (common.at(-1) ?? result.months.at(-1) ?? ""));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Site Comparison could not be loaded.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!data || !referenceMonth) { setRackState({}); return; }
    let cancelled = false;
    setRackLoading(true);
    void Promise.all(data.sites.map(async site => {
      try {
        const [racks, unit] = await Promise.all([
          api<RackSnapshotApiResponse>(`/racks?siteId=${site.site.id}&month=${referenceMonth}`),
          api<{ snapshot: RackUnitSnapshot | null }>(`/rack-unit-capacity?siteId=${site.site.id}&month=${referenceMonth}`)
        ]);
        return [site.site.id, { rack: racks.snapshot, unit: unit.snapshot, unavailable: false }] as const;
      } catch {
        return [site.site.id, { rack: null, unit: null, unavailable: true }] as const;
      }
    })).then(rows => {
      if (!cancelled) setRackState(Object.fromEntries(rows));
    }).finally(() => { if (!cancelled) setRackLoading(false); });
    return () => { cancelled = true; };
  }, [data, referenceMonth]);

  const windowMonths = useMemo(() => data?.months.filter(month => month <= referenceMonth).slice(-range) ?? [], [data, referenceMonth, range]);
  const chartData = useMemo(() => windowMonths.map(month => {
    const row: Record<string, string | number | null> = { month };
    for (const site of data?.sites ?? []) {
      const values = site.months.find(entry => entry.month === month)?.metrics;
      row[`${site.site.code}-energy`] = values?.buildingEnergy ?? null;
      row[`${site.site.code}-cost`] = values?.floorCost ?? null;
    }
    return row;
  }), [data, windowMonths]);

  if (error) return <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200">{error}</section>;
  if (!data) return <p className="text-sm text-slate-400">Loading Site Comparison…</p>;

  return <section className="space-y-5" data-testid="web-site-comparison">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="font-display text-2xl font-bold">{th ? "เปรียบเทียบไซต์" : "Site Comparison"}</h2><p className="mt-1 text-sm text-slate-400">{th ? "ช่วงเวลาเดียวกัน ใช้สูตรเดียวกับ Desktop และแยกข้อมูลแต่ละไซต์" : "Same period, shared Desktop formulas, and separate facility records."}</p></div>
      <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-teal-500"><RefreshCw className="h-4 w-4" />{th ? "โหลดใหม่" : "Refresh"}</button>
    </div>

    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <label className="text-sm">{th ? "เดือนอ้างอิง" : "Reference month"}<select value={referenceMonth} onChange={event => setReferenceMonth(event.target.value)} className="ml-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{data.months.map(month => <option key={month} value={month}>{month}</option>)}</select></label>
      <div className="flex rounded-lg border border-slate-700 p-1" aria-label={th ? "ช่วงข้อมูลที่แสดง" : "Comparison display range"}>{([3, 6, 12] as const).map(value => <button type="button" key={value} onClick={() => setRange(value)} aria-pressed={range === value} className={`rounded px-2 py-1 text-xs ${range === value ? "bg-teal-500 text-slate-950" : "text-slate-300"}`}>{th ? `ล่าสุด ${value}` : `Last ${value}`}</button>)}</div>
    </div>

    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="min-w-[960px] w-full text-sm"><thead className="bg-slate-900 text-left text-slate-400"><tr><th className="p-3">Facility</th><th className="p-3 text-right">Building energy</th><th className="p-3 text-right">Building cost</th><th className="p-3 text-right">Floor energy</th><th className="p-3 text-right">Floor cost</th><th className="p-3 text-right">Average rate</th><th className="p-3 text-right">Floor share</th></tr></thead><tbody>{data.sites.map(site => { const values: ComparisonMetric | null = site.months.find(entry => entry.month === referenceMonth)?.metrics ?? null; return <tr key={site.site.id} className="border-t border-slate-800"><td className="p-3"><b>{site.site.name}</b><br /><span className="text-xs text-slate-500">{referenceMonth}</span></td><td className="p-3 text-right font-mono">{metric(values?.buildingEnergy)} kWh</td><td className="p-3 text-right font-mono">{metric(values?.buildingCost)} THB</td><td className="p-3 text-right font-mono">{metric(values?.floorEnergy)} kWh</td><td className="p-3 text-right font-mono">{metric(values?.floorCost)} THB</td><td className="p-3 text-right font-mono">{metric(values?.avgRate)} THB/kWh</td><td className="p-3 text-right font-mono">{metric(values?.floorShare, "%")}</td></tr>; })}</tbody></table>
    </div>

    {chartData.length === 0 ? <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">{th ? "ไม่มีข้อมูลสำหรับช่วงเปรียบเทียบนี้" : "No records are available for this comparison period."}</section> : <div className="grid gap-5 xl:grid-cols-2"><TrendCard title={th ? "แนวโน้มการใช้พลังงานรายเดือน" : "Monthly Energy Consumption Trend"} icon={<TrendingUp className="h-4 w-4 text-indigo-300" />} data={chartData} sites={data.sites} suffix="energy" unit="kWh" /><TrendCard title={th ? "แนวโน้มค่าไฟฟ้าชั้น 4" : "Floor 4 Electricity Cost Trend"} icon={<Coins className="h-4 w-4 text-emerald-300" />} data={chartData} sites={data.sites} suffix="cost" unit="THB" /></div>}

    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="mb-4 flex items-center gap-2"><Server className="h-4 w-4 text-indigo-300" /><div><h3 className="font-semibold">Rack Capacity and Utilization</h3><p className="text-xs text-slate-400">Snapshots for the selected month; data stays isolated by facility.</p></div></div><div className="grid gap-4 lg:grid-cols-2">{data.sites.map(site => { const state = rackState[site.site.id]; const counts = rackCounts(state?.rack ?? null); return <article key={site.site.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><div className="mb-3 flex items-center justify-between"><b>{site.site.name}</b><span className="text-xs text-slate-500">{referenceMonth}</span></div>{rackLoading && !state ? <p className="text-sm text-slate-400">Loading rack snapshot…</p> : state?.unavailable ? <p className="text-sm text-amber-300">Rack snapshot unavailable.</p> : !state?.rack ? <p className="text-sm text-slate-400">No rack snapshot for this month.</p> : <><div className="flex justify-between text-sm"><span>In use</span><b className="font-mono text-indigo-300">{counts.inUse} / {counts.total}</b></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-indigo-500" style={{ width: `${counts.total === 0 ? 0 : (counts.inUse / counts.total) * 100}%` }} /></div><div className="mt-3 grid grid-cols-3 gap-3 text-xs"><span>Available <b className="block font-mono text-emerald-300">{counts.available}</b></span><span>Reserved <b className="block font-mono text-amber-300">{counts.reserved}</b></span><span>Other <b className="block font-mono text-slate-300">{counts.total - counts.inUse - counts.available - counts.reserved}</b></span></div></>}</article>; })}</div></section>

    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="mb-4 flex items-center gap-2"><Gauge className="h-4 w-4 text-teal-300" /><div><h3 className="font-semibold">Rack Unit Capacity and Utilization</h3><p className="text-xs text-slate-400">Saved U-capacity rows only; rack counts are never used as a substitute.</p></div></div><div className="grid gap-4 lg:grid-cols-2">{data.sites.map(site => { const state = rackState[site.site.id]; const unit = state?.unit; return <article key={site.site.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><div className="mb-3 flex items-center justify-between"><b>{site.site.name}</b><span className="text-xs text-slate-500">{referenceMonth}</span></div>{rackLoading && !state ? <p className="text-sm text-slate-400">Loading rack-unit snapshot…</p> : state?.unavailable ? <p className="text-sm text-amber-300">Rack-unit snapshot unavailable.</p> : !unit ? <p className="text-sm text-slate-400">No rack-unit snapshot for this month.</p> : <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><span>Total U <b className="block font-mono">{metric(unit.totalU)}</b></span><span>Used U <b className="block font-mono text-indigo-300">{metric(unit.usedU)}</b></span><span>Available U <b className="block font-mono text-emerald-300">{metric(unit.availableU)}</b></span><span>Utilization <b className="block font-mono text-teal-300">{metric(unit.usagePercent, "%")}</b></span></div>}</article>; })}</div></section>
  </section>;
}
