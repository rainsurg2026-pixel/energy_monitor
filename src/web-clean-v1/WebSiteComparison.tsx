import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Coins, Gauge, RefreshCw, Server, TrendingUp } from "lucide-react";
import { CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { api } from "./api";
import type { ComparisonMetric, RackSnapshotApiResponse, SiteComparisonExport } from "./exports";

type RackUnitSnapshot = { totalU: number; usedU: number; availableU: number; usagePercent: number | null };
type RackSnapshot = NonNullable<RackSnapshotApiResponse["snapshot"]>;
type RackState = { rack: RackSnapshot | null; unit: RackUnitSnapshot | null; unavailable: boolean };

const siteColour = (index: number) => index % 2 === 0 ? "var(--chart-series-a)" : "var(--chart-series-b)";
const formatCompact = (value: number, unit: string) => {
  if (!Number.isFinite(value)) return "—";
  const formatted = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
  return unit === "%" ? `${formatted}%` : formatted;
};
const formatMonthLabel = (month: string) => {
  const [year, monthNumber] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const index = Number(monthNumber) - 1;
  return names[index] && /^\d{4}$/u.test(year) ? `${names[index]}-${year.slice(-2)}` : month;
};
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
  suffix: "energy" | "cost" | "rack-usage";
  unit: string;
}) {
  return <section className="h-[26rem] rounded-xl border border-slate-800 bg-slate-900 p-4">
    <h3 className="mb-3 flex items-center gap-2 font-semibold">{icon}{title}</h3>
    <ResponsiveContainer width="100%" height="90%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={formatMonthLabel} />
        <YAxis tickFormatter={value => formatCompact(Number(value), unit)} />
        <Tooltip labelFormatter={label => formatMonthLabel(String(label))} formatter={(value: number | string | undefined) => value === null || value === undefined ? "—" : `${formatNumber2(Number(value))} ${unit}`} />
        <Legend />
        {sites.map((site, index) => <Line key={`${site.site.id}-${suffix}`} type="monotone" dataKey={`${site.site.code}-${suffix}`} name={site.site.name} stroke={siteColour(index)} connectNulls={false} dot={{ r: 3 }}>
          <LabelList dataKey={`${site.site.code}-${suffix}`} position="top" formatter={value => formatCompact(Number(value), unit)} />
        </Line>)}
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
  const copy = th ? {
    loading: "กำลังโหลดการเปรียบเทียบไซต์…",
    facility: "ไซต์",
    buildingEnergy: "พลังงานอาคาร",
    buildingCost: "ค่าไฟฟ้าอาคาร",
    floorEnergy: "พลังงานชั้น 4",
    floorCost: "ค่าไฟฟ้าชั้น 4",
    averageRate: "อัตราเฉลี่ย",
    floorShare: "สัดส่วนชั้น 4",
    rackTrend: "แนวโน้มการใช้งาน Rack Unit",
    rackTitle: "ความจุแร็คและการใช้งาน",
    rackDescription: "ข้อมูล snapshot ของเดือนที่เลือก แยกข้อมูลตามไซต์",
    loadingRack: "กำลังโหลด snapshot แร็ค…",
    rackUnavailable: "ไม่สามารถโหลด snapshot แร็คได้",
    noRack: "ไม่มี snapshot แร็คสำหรับเดือนนี้",
    inUse: "ใช้งาน",
    available: "ว่าง",
    reserved: "สำรอง",
    other: "อื่น ๆ",
    unitTitle: "ความจุหน่วยแร็คและการใช้งาน",
    unitDescription: "แสดงเฉพาะข้อมูล U ที่บันทึกไว้ ไม่ใช้จำนวนแร็คแทนข้อมูล U",
    loadingUnit: "กำลังโหลด snapshot หน่วยแร็ค…",
    unitUnavailable: "ไม่สามารถโหลด snapshot หน่วยแร็คได้",
    noUnit: "ไม่มี snapshot หน่วยแร็คสำหรับเดือนนี้",
    totalU: "ทั้งหมด U",
    usedU: "ใช้งาน U",
    availableU: "คงเหลือ U",
    utilization: "การใช้งาน"
  } : {
    loading: "Loading Site Comparison…",
    facility: "Facility",
    buildingEnergy: "Building energy",
    buildingCost: "Building cost",
    floorEnergy: "Floor energy",
    floorCost: "Floor cost",
    averageRate: "Average rate",
    floorShare: "Floor share",
    rackTrend: "Rack Unit Utilization Trend",
    rackTitle: "Rack Capacity and Utilization",
    rackDescription: "Snapshots for the selected month; data stays isolated by facility.",
    loadingRack: "Loading rack snapshot…",
    rackUnavailable: "Rack snapshot unavailable.",
    noRack: "No rack snapshot for this month.",
    inUse: "In use",
    available: "Available",
    reserved: "Reserved",
    other: "Other",
    unitTitle: "Rack Unit Capacity and Utilization",
    unitDescription: "Saved U-capacity rows only; rack counts are never used as a substitute.",
    loadingUnit: "Loading rack-unit snapshot…",
    unitUnavailable: "Rack-unit snapshot unavailable.",
    noUnit: "No rack-unit snapshot for this month.",
    totalU: "Total U",
    usedU: "Used U",
    availableU: "Available U",
    utilization: "Utilization"
  };
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
  const rackChartData = useMemo(() => windowMonths.map(month => {
    const row: Record<string, string | number | null> = { month };
    for (const site of data?.sites ?? []) {
      row[`${site.site.code}-rack-usage`] = site.rackUnitCapacity?.find(entry => entry.month === month)?.usagePercent ?? null;
    }
    return row;
  }), [data, windowMonths]);
  const hasRackTrend = rackChartData.some(row => Object.entries(row).some(([key, value]) => key.endsWith("-rack-usage") && typeof value === "number"));

  if (error) return <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200">{error}</section>;
  if (!data) return <p className="text-sm text-slate-400">{copy.loading}</p>;

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
      <table className="min-w-[960px] w-full text-sm"><thead className="bg-slate-900 text-left text-slate-400"><tr><th className="p-3">{copy.facility}</th><th className="p-3 text-right">{copy.buildingEnergy}</th><th className="p-3 text-right">{copy.buildingCost}</th><th className="p-3 text-right">{copy.floorEnergy}</th><th className="p-3 text-right">{copy.floorCost}</th><th className="p-3 text-right">{copy.averageRate}</th><th className="p-3 text-right">{copy.floorShare}</th></tr></thead><tbody>{data.sites.map(site => { const values: ComparisonMetric | null = site.months.find(entry => entry.month === referenceMonth)?.metrics ?? null; return <tr key={site.site.id} className="border-t border-slate-800"><td className="p-3"><b>{site.site.name}</b><br /><span className="text-xs text-slate-500">{referenceMonth}</span></td><td className="p-3 text-right font-mono">{metric(values?.buildingEnergy)} kWh</td><td className="p-3 text-right font-mono">{metric(values?.buildingCost)} THB</td><td className="p-3 text-right font-mono">{metric(values?.floorEnergy)} kWh</td><td className="p-3 text-right font-mono">{metric(values?.floorCost)} THB</td><td className="p-3 text-right font-mono">{metric(values?.avgRate)} THB/kWh</td><td className="p-3 text-right font-mono">{metric(values?.floorShare, "%")}</td></tr>; })}</tbody></table>
    </div>

    {chartData.length === 0 ? <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">{th ? "ไม่มีข้อมูลสำหรับช่วงเปรียบเทียบนี้" : "No records are available for this comparison period."}</section> : <div className="grid grid-cols-1 gap-5"><TrendCard title={th ? "แนวโน้มการใช้พลังงานรายเดือน" : "Monthly Energy Consumption Trend"} icon={<TrendingUp className="h-4 w-4 text-indigo-300" />} data={chartData} sites={data.sites} suffix="energy" unit="kWh" /><TrendCard title={th ? "แนวโน้มค่าไฟฟ้าชั้น 4" : "Floor 4 Electricity Cost Trend"} icon={<Coins className="h-4 w-4 text-emerald-300" />} data={chartData} sites={data.sites} suffix="cost" unit="THB" />{hasRackTrend && <TrendCard title={copy.rackTrend} icon={<Gauge className="h-4 w-4 text-teal-300" />} data={rackChartData} sites={data.sites} suffix="rack-usage" unit="%" />}</div>}

    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="mb-4 flex items-center gap-2"><Server className="h-4 w-4 text-indigo-300" /><div><h3 className="font-semibold">{copy.rackTitle}</h3><p className="text-xs text-slate-400">{copy.rackDescription}</p></div></div><div className="grid gap-4 lg:grid-cols-2">{data.sites.map(site => { const state = rackState[site.site.id]; const counts = rackCounts(state?.rack ?? null); return <article key={site.site.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><div className="mb-3 flex items-center justify-between"><b>{site.site.name}</b><span className="text-xs text-slate-500">{referenceMonth}</span></div>{rackLoading && !state ? <p className="text-sm text-slate-400">{copy.loadingRack}</p> : state?.unavailable ? <p className="text-sm text-amber-300">{copy.rackUnavailable}</p> : !state?.rack ? <p className="text-sm text-slate-400">{copy.noRack}</p> : <><div className="flex justify-between text-sm"><span>{copy.inUse}</span><b className="font-mono text-indigo-300">{counts.inUse} / {counts.total}</b></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-indigo-500" style={{ width: `${counts.total === 0 ? 0 : (counts.inUse / counts.total) * 100}%` }} /></div><div className="mt-3 grid grid-cols-3 gap-3 text-xs"><span>{copy.available} <b className="block font-mono text-emerald-300">{counts.available}</b></span><span>{copy.reserved} <b className="block font-mono text-amber-300">{counts.reserved}</b></span><span>{copy.other} <b className="block font-mono text-slate-300">{counts.total - counts.inUse - counts.available - counts.reserved}</b></span></div></>}</article>; })}</div></section>

    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="mb-4 flex items-center gap-2"><Gauge className="h-4 w-4 text-teal-300" /><div><h3 className="font-semibold">{copy.unitTitle}</h3><p className="text-xs text-slate-400">{copy.unitDescription}</p></div></div><div className="grid gap-4 lg:grid-cols-2">{data.sites.map(site => { const state = rackState[site.site.id]; const unit = state?.unit; return <article key={site.site.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"><div className="mb-3 flex items-center justify-between"><b>{site.site.name}</b><span className="text-xs text-slate-500">{referenceMonth}</span></div>{rackLoading && !state ? <p className="text-sm text-slate-400">{copy.loadingUnit}</p> : state?.unavailable ? <p className="text-sm text-amber-300">{copy.unitUnavailable}</p> : !unit ? <p className="text-sm text-slate-400">{copy.noUnit}</p> : <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><span>{copy.totalU} <b className="block font-mono">{metric(unit.totalU)}</b></span><span>{copy.usedU} <b className="block font-mono text-indigo-300">{metric(unit.usedU)}</b></span><span>{copy.availableU} <b className="block font-mono text-emerald-300">{metric(unit.availableU)}</b></span><span>{copy.utilization} <b className="block font-mono text-teal-300">{metric(unit.usagePercent, "%")}</b></span></div>}</article>; })}</div></section>
  </section>;
}
