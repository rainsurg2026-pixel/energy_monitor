import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Coins, RefreshCw, TrendingUp, Zap } from "lucide-react";
import { CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getComparisonDisplayMonths } from "../domain/facilityComparison";
import { formatNumber2 } from "../utils/numberFormatBridge";
import { monthLabelLong } from "../utils/monthUtils";
import { api } from "./api";
import type { ComparisonMetric, SiteComparisonExport } from "./exports";

type ComparisonChartSuffix = "building-energy" | "floor-energy" | "building-cost" | "floor-cost";

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

/** Keep missing calendar months as explicit null chart positions. */
function withLeadingChartGap(data: Array<Record<string, string | number | null>>, seriesKeys: readonly string[]) {
  if (data.length === 0) return data;
  const gap: Record<string, string | number | null> = { ...data[0], month: "" };
  for (const key of seriesKeys) gap[key] = null;
  return [gap, ...data];
}

function comparisonChartYAxisDomain(data: Array<Record<string, string | number | null>>, sites: SiteComparisonExport["sites"], suffix: ComparisonChartSuffix): [number, number] {
  const values = data.flatMap(row => sites.map(site => row[`${site.site.code}-${suffix}`])).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const maximum = Math.max(0, ...values);
  return [0, maximum > 0 ? maximum * 1.12 : 1];
}

function chartLabel(value: unknown, unit: string): string {
  return typeof value === "number" && Number.isFinite(value) ? formatCompact(value, unit) : "";
}

function TrendCard({ title, icon, data, sites, suffix, unit, axisLabel }: {
  title: string;
  icon: React.ReactNode;
  data: Array<Record<string, string | number | null>>;
  sites: SiteComparisonExport["sites"];
  suffix: ComparisonChartSuffix;
  unit: string;
  axisLabel: string;
}) {
  const seriesKeys = sites.map(site => `${site.site.code}-${suffix}`);
  const chartData = withLeadingChartGap(data, seriesKeys);
  const yDomain = comparisonChartYAxisDomain(data, sites, suffix);
  return <section className="h-[26rem] rounded-xl border border-slate-800 bg-slate-900 p-4" aria-label={title}>
    <h3 className="mb-3 flex items-center gap-2 font-semibold">{icon}{title}</h3>
    <ResponsiveContainer width="100%" height="90%">
      <LineChart data={chartData} margin={{ top: 24, right: 28, left: 24, bottom: 28 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis dataKey="month" tickFormatter={formatMonthLabel} />
        <YAxis domain={yDomain} tickFormatter={value => formatCompact(Number(value), unit)} label={{ value: axisLabel, angle: -90, position: "insideLeft", fill: "var(--chart-axis)", fontSize: 12 }} />
        <Tooltip labelFormatter={label => formatMonthLabel(String(label))} formatter={(value: number | string | undefined) => typeof value === "number" && Number.isFinite(value) ? `${formatNumber2(value)} ${unit}` : "—"} />
        <Legend />
        {sites.map((site, index) => <Line key={`${site.site.id}-${suffix}`} type="monotone" dataKey={`${site.site.code}-${suffix}`} name={site.site.name} stroke={siteColour(index)} connectNulls={false} dot={{ r: 3 }} isAnimationActive={false}>
          <LabelList dataKey={`${site.site.code}-${suffix}`} position="top" offset={8} fill={siteColour(index)} fontSize={10} formatter={value => chartLabel(value, unit)} />
        </Line>)}
      </LineChart>
    </ResponsiveContainer>
  </section>;
}

/** Production-web Energy and Cost comparison.  All values come from the
 * server's site-scoped monthly calculation DTO; this page intentionally has
 * no capacity or infrastructure sections. */
export default function WebSiteComparison({ lang = "th" }: { lang?: "th" | "en" }) {
  const th = lang === "th";
  const copy = {
    loading: th ? "กำลังโหลดการเปรียบเทียบไซต์…" : "Loading Site Energy & Cost Comparison…",
    facility: th ? "ไซต์" : "Facility",
    buildingEnergy: "Building Energy (kWh)",
    buildingCost: "Building Cost (THB)",
    floorEnergy: "4th Floor Energy (kWh)",
    floorCost: "Estimated 4th Floor Cost (THB)",
    averageRate: "Average Unit Rate (THB/kWh)",
    floorShare: "4th Floor Share (%)",
    noRecords: th ? "ไม่มีข้อมูลสำหรับช่วงเวลาที่เลือก" : "No records are available for this comparison period."
  };
  const [data, setData] = useState<SiteComparisonExport | null>(null);
  const [referenceMonth, setReferenceMonth] = useState("");
  const [range, setRange] = useState<3 | 6 | 12>(12);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api<SiteComparisonExport>("/site-comparison");
      const common = result.months.filter(month => result.sites.every(site => site.months.some(entry => entry.month === month && entry.metrics)));
      setData(result);
      setReferenceMonth(current => current && result.months.includes(current) ? current : (common.at(-1) ?? result.months.at(-1) ?? ""));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Site Energy & Cost Comparison could not be loaded.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sites = useMemo(() => [...(data?.sites ?? [])].sort((left, right) => left.site.name.localeCompare(right.site.name) || left.site.id - right.site.id), [data]);
  const windowMonths = useMemo(() => getComparisonDisplayMonths(data?.months ?? [], referenceMonth, range), [data, referenceMonth, range]);
  const chartData = useMemo(() => windowMonths.map(month => {
    const row: Record<string, string | number | null> = { month };
    for (const site of sites) {
      const values = site.months.find(entry => entry.month === month)?.metrics;
      row[`${site.site.code}-building-energy`] = values?.buildingEnergy ?? null;
      row[`${site.site.code}-floor-energy`] = values?.floorEnergy ?? null;
      row[`${site.site.code}-building-cost`] = values?.buildingCost ?? null;
      row[`${site.site.code}-floor-cost`] = values?.floorCost ?? null;
    }
    return row;
  }), [sites, windowMonths]);
  const hasChartData = chartData.some(row => Object.entries(row).some(([key, value]) => key !== "month" && typeof value === "number" && Number.isFinite(value)));

  if (error) return <section role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200">{error}</section>;
  if (!data) return <p role="status" className="text-sm text-slate-400">{copy.loading}</p>;

  return <section className="space-y-5" data-testid="web-site-comparison" data-page="site-energy-cost-comparison">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="font-display text-2xl font-bold">{th ? "เปรียบเทียบพลังงานและค่าใช้จ่ายของไซต์" : "Site Energy & Cost Comparison"}</h2><p className="mt-1 text-sm text-slate-400">Compare facilities using the same reporting period and calculation method.</p><p className="mt-2 text-xs uppercase tracking-wide text-slate-500">Reporting period: <span className="font-mono text-slate-300" data-testid="comparison-reporting-period">{referenceMonth ? monthLabelLong(referenceMonth, "en") : "—"}</span></p></div>
      <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-teal-500"><RefreshCw className="h-4 w-4" />{th ? "โหลดใหม่" : "Refresh"}</button>
    </div>

    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
      <label className="text-sm">{th ? "เดือนอ้างอิง" : "Reference month"}<select value={referenceMonth} onChange={event => setReferenceMonth(event.target.value)} className="ml-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{data.months.map(month => <option key={month} value={month}>{monthLabelLong(month, "en")}</option>)}</select></label>
      <div className="flex rounded-lg border border-slate-700 p-1" aria-label={th ? "ช่วงข้อมูลที่แสดง" : "Comparison display range"}>{([3, 6, 12] as const).map(value => <button type="button" key={value} onClick={() => setRange(value)} aria-pressed={range === value} className={`rounded px-2 py-1 text-xs ${range === value ? "bg-teal-500 text-slate-950" : "text-slate-300"}`}>{th ? `ล่าสุด ${value}` : `Last ${value}`}</button>)}</div>
    </div>

    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="min-w-[1180px] w-full text-sm"><thead className="bg-slate-900 text-left text-slate-400"><tr><th scope="col" className="p-3">{copy.facility}</th><th scope="col" className="p-3 text-right">{copy.buildingEnergy}</th><th scope="col" className="p-3 text-right">{copy.buildingCost}</th><th scope="col" className="p-3 text-right">{copy.floorEnergy}</th><th scope="col" className="p-3 text-right">{copy.floorCost}</th><th scope="col" className="p-3 text-right">{copy.averageRate}</th><th scope="col" className="p-3 text-right">{copy.floorShare}</th></tr></thead><tbody>{sites.map(site => { const values: ComparisonMetric | null = site.months.find(entry => entry.month === referenceMonth)?.metrics ?? null; return <tr key={site.site.id} className="border-t border-slate-800"><th scope="row" className="p-3 text-left"><b>{site.site.name}</b></th><td className="p-3 text-right font-mono">{metric(values?.buildingEnergy)}</td><td className="p-3 text-right font-mono">{metric(values?.buildingCost)}</td><td className="p-3 text-right font-mono">{metric(values?.floorEnergy)}</td><td className="p-3 text-right font-mono">{metric(values?.floorCost)}</td><td className="p-3 text-right font-mono">{metric(values?.avgRate)}</td><td className="p-3 text-right font-mono">{metric(values?.floorShare)}</td></tr>; })}</tbody></table>
    </div>

    {!hasChartData ? <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">{copy.noRecords}</section> : <div className="grid grid-cols-1 gap-5">
      <TrendCard title="Total Building Energy Consumption Trend" icon={<TrendingUp className="h-4 w-4 text-indigo-300" />} data={chartData} sites={sites} suffix="building-energy" unit="kWh" axisLabel="Energy (kWh)" />
      <TrendCard title="4th Floor Energy Consumption Trend" icon={<Zap className="h-4 w-4 text-emerald-300" />} data={chartData} sites={sites} suffix="floor-energy" unit="kWh" axisLabel="Energy (kWh)" />
      <TrendCard title="Total Building Electricity Cost Trend" icon={<Coins className="h-4 w-4 text-amber-300" />} data={chartData} sites={sites} suffix="building-cost" unit="THB" axisLabel="Cost (THB)" />
      <TrendCard title="Estimated 4th Floor Electricity Cost Trend" icon={<Calculator className="h-4 w-4 text-teal-300" />} data={chartData} sites={sites} suffix="floor-cost" unit="THB" axisLabel="Estimated Cost (THB)" />
    </div>}
  </section>;
}
