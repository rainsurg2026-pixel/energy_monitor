import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, FileDown, Monitor, RotateCcw, X } from "lucide-react";
import { HistoryProvider } from "./HistoryProvider";
import { ReportRegistry } from "./ReportRegistry";
import { ReportingMonthProvider, useReportingMonth } from "./ReportingMonthContext";
import type { ReportHistoryItem, ReportSectionId, ReportType } from "./reportingTypes";
import { formatTimestamp } from "../utils";

export type ReportingFormat = "pdf" | "png" | "zip" | "excel" | "csv" | "html" | "powerpoint";
export interface ReportRequest { type: ReportType; format: ReportingFormat; month: string; period: string; from: string; to: string; sections: ReportSectionId[]; filename: string; }
export type ReportPreviewRequest = Pick<ReportRequest, "month" | "period" | "from" | "to" | "sections">;

interface Props {
  facility: string;
  availableMonths: string[];
  initialMonth?: string;
  previewHtml: string | null;
  previewStatus: "ready" | "generating" | "error";
  previewError?: string | null;
  onPreview: (request: ReportPreviewRequest) => Promise<void>;
  onGenerate: (request: ReportRequest) => Promise<{ filename: string; path?: string } | null>;
  onReveal?: (path: string) => void;
}

const TYPES: Array<{ id: ReportType; title: string }> = [{ id: "all", title: "All Report" }];

function reportSiteCode(facility: string): string {
  if (/rangsit/i.test(facility)) return "RST";
  if (/srinakarin/i.test(facility)) return "SNK";
  const fallback = facility.replace(/[^a-z0-9]+/gi, "").toUpperCase();
  return fallback.slice(0, 3) || "SITE";
}

function defaultReportFilename(facility: string, month: string): string {
  const yearMonth = /^\d{4}-\d{2}$/.test(month) ? month.replace("-", "") : "202601";
  return `DC_Status_MonthlyReport of ${reportSiteCode(facility)}_${yearMonth}`;
}

function displayMonth(month: string) { return month ? new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(`${month}-01T00:00:00`)) : "No data"; }

export default function ReportingCenter(props: Props) {
  const initialMonth = props.initialMonth ?? props.availableMonths.at(-1) ?? new Date().toISOString().slice(0, 7);
  return <ReportingMonthProvider initialMonth={initialMonth}><Workspace {...props} /></ReportingMonthProvider>;
}

function Workspace({ facility, availableMonths, previewHtml, previewStatus, previewError, onPreview, onGenerate, onReveal }: Props) {
  const reportingMonth = useReportingMonth();
  const [type, setType] = useState<ReportType>("all");
  const [format, setFormat] = useState<ReportingFormat>("pdf");
  const [sections, setSections] = useState<ReportSectionId[]>(() => ReportRegistry.forType("all").map(section => section.id));
  const [search, setSearch] = useState("");
  const [filename, setFilename] = useState("");
  const [history, setHistory] = useState<ReportHistoryItem[]>(() => HistoryProvider.list());
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(85);
  const month = reportingMonth.period === "range" ? reportingMonth.to : reportingMonth.month;
  const previewRequest: ReportPreviewRequest = { month, period: reportingMonth.period, from: reportingMonth.from, to: reportingMonth.to, sections };
  const previewSectionsKey = sections.join(",");
  const filenameBase = defaultReportFilename(facility, month);
  const filteredSections = useMemo(() => ReportRegistry.all().filter(section => section.title.toLowerCase().includes(search.toLowerCase())), [search]);
  const pageCount = useMemo(() => previewHtml ? (previewHtml.match(/page-break-(before|after)/g)?.length ?? 0) + 1 : 0, [previewHtml]);

  useEffect(() => { void onPreview(previewRequest); }, [month, reportingMonth.period, reportingMonth.from, reportingMonth.to, previewSectionsKey, onPreview]);
  useEffect(() => { setFilename(filenameBase); }, [filenameBase, reportingMonth.period]);
  useEffect(() => { if (type !== "all") setSections(ReportRegistry.forType(type).map(section => section.id)); }, [type]);

  const generate = async () => {
    if (format === "powerpoint") return;
    setBusy(true);
    try {
      const result = await onGenerate({ type, format, month, period: reportingMonth.period, from: reportingMonth.from, to: reportingMonth.to, sections, filename: filename.trim() || filenameBase });
      if (result) {
        const item: ReportHistoryItem = { id: crypto.randomUUID(), filename: result.filename, facility, month: reportingMonth.period === "range" ? `${displayMonth(reportingMonth.from)}–${displayMonth(reportingMonth.to)}` : displayMonth(month), pages: format === "pdf" ? pageCount || null : null, createdAt: new Date().toISOString(), path: result.path };
        setHistory(HistoryProvider.add(item));
      }
    } finally { setBusy(false); }
  };
  const toggle = (id: ReportSectionId) => setSections(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const periodDescription = reportingMonth.period === "range" ? `${displayMonth(reportingMonth.from)} – ${displayMonth(reportingMonth.to)}` : reportingMonth.period === "history" ? "Full history" : displayMonth(month);

  return <div className="space-y-5 animate-fadeIn" data-testid="reporting-center">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-rose-400">Reporting Center</p><h1 className="text-xl font-display font-bold text-slate-100">Reports &amp; Export</h1><p className="text-xs text-slate-400 mt-1">One reporting month, one renderer, consistent preview and PDF output.</p></div>
      <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300"><span className="text-slate-500">Context </span>{facility} · {periodDescription}</div>
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(270px,.85fr)_minmax(460px,1.8fr)_minmax(270px,.85fr)]">
      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3"><h2 className="text-sm font-bold text-slate-100">Report Builder</h2>
          <fieldset><legend className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">Report type</legend><div className="grid grid-cols-1 gap-2">{TYPES.map(item => <label key={item.id} className="cursor-default rounded-lg border border-rose-500 bg-rose-500/10 px-2 py-2 text-[11px] font-semibold text-rose-200"><input className="sr-only" type="radio" name="report-type" checked readOnly />{item.title}</label>)}</div></fieldset>
          <fieldset><legend className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">Reporting period</legend><select aria-label="Reporting period" value={reportingMonth.period} onChange={event => reportingMonth.setPeriod(event.target.value as typeof reportingMonth.period)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200"><option value="current">Current Month</option><option value="single">Single Month</option><option value="range">Month Range</option><option value="history">Full History</option></select>
          {reportingMonth.period !== "history" && <div className="grid grid-cols-2 gap-2 mt-2">{reportingMonth.period === "range" ? <><input aria-label="From month" type="month" value={reportingMonth.from} onChange={event => reportingMonth.setRange(event.target.value, reportingMonth.to)} className="input-month"/><input aria-label="To month" type="month" value={reportingMonth.to} onChange={event => reportingMonth.setRange(reportingMonth.from, event.target.value)} className="input-month"/></> : <select aria-label="Reporting month" value={reportingMonth.month} onChange={event => reportingMonth.setMonth(event.target.value)} className="col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200">{availableMonths.slice().reverse().map(item => <option key={item} value={item}>{displayMonth(item)}</option>)}</select>}</div>}</fieldset>
        </section>
        {type === "all" && <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-bold text-slate-100">Custom sections</h2><span className="text-[10px] text-slate-500">{sections.length} selected</span></div><input aria-label="Search report sections" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search sections" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-200"/><div className="flex gap-2 text-[10px]"><button onClick={() => setSections(ReportRegistry.all().map(section => section.id))} className="text-rose-300 hover:text-rose-200">Select all</button><button onClick={() => setSections([])} className="text-slate-400 hover:text-slate-200">Select none</button></div><div className="space-y-1">{filteredSections.map(section => <label key={section.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-xs text-slate-300 hover:bg-slate-800"><input type="checkbox" checked={sections.includes(section.id)} onChange={() => toggle(section.id)} />{section.title}</label>)}</div></section>}
      </aside>
      <main className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-3"><div className="flex items-center gap-2"><Monitor className="w-4 h-4 text-rose-400"/><h2 className="text-sm font-bold text-slate-100">Live Preview</h2><span className={`rounded-full px-2 py-0.5 text-[10px] ${previewStatus === "error" ? "bg-rose-500/15 text-rose-300" : previewStatus === "generating" ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>{previewStatus === "generating" ? "Generating" : previewStatus === "error" ? "Error" : "Ready"}</span></div><div className="flex items-center gap-1"><button aria-label="Zoom out" onClick={() => setZoom(current => Math.max(50, current - 10))} className="px-2 py-1 text-slate-400 hover:text-white">−</button><span className="text-[10px] text-slate-500">{zoom}% · {pageCount || "–"} pages</span><button aria-label="Zoom in" onClick={() => setZoom(current => Math.min(120, current + 10))} className="px-2 py-1 text-slate-400 hover:text-white">+</button><button aria-label="Refresh preview" onClick={() => void onPreview(previewRequest)} className="p-1 text-slate-400 hover:text-white"><RotateCcw className="w-3.5 h-3.5"/></button></div></div>
        <div className="min-h-[640px] bg-slate-950 p-4 overflow-auto">{previewStatus === "error" ? <div className="grid min-h-[560px] place-items-center text-center"><div><p className="text-sm text-rose-300">Preview could not be prepared.</p><p className="mt-1 text-xs text-slate-500">{previewError ?? "Try refreshing the preview."}</p><button onClick={() => void onPreview(previewRequest)} className="mt-3 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white">Retry</button></div></div> : previewHtml ? <div style={{ width: `${zoom}%`, minWidth: "640px" }} className="mx-auto origin-top"><iframe title="Report HTML preview" sandbox="" srcDoc={previewHtml} className="h-[760px] w-full rounded-sm bg-white shadow-2xl" /></div> : <div className="grid min-h-[560px] place-items-center text-xs text-slate-500">Preparing report preview…</div>}</div>
      </main>
      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start"><section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3"><h2 className="text-sm font-bold text-slate-100">Export Options</h2><fieldset><legend className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">Format</legend>{(["pdf", "excel", "csv"] as ReportingFormat[]).map(item => <label key={item} className="flex items-center justify-between rounded-lg px-2 py-2 text-xs text-slate-300 hover:bg-slate-800"><span><input type="radio" className="mr-2" name="format" checked={format === item} onChange={() => setFormat(item)} />{item === "csv" ? "CSV" : item === "excel" ? "Excel" : "PDF"}</span></label>)}</fieldset><label className="block text-[10px] uppercase tracking-wider font-bold text-slate-500">Filename<input value={filename} onChange={event => setFilename(event.target.value.replace(/[\\/:*?\"<>|]/g, "_"))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-normal text-slate-200"/></label><details className="text-xs text-slate-400"><summary className="cursor-pointer">Advanced layout options</summary><div className="mt-2 grid grid-cols-2 gap-2"><select aria-label="Paper size" className="rounded-lg border border-slate-700 bg-slate-950 p-2"><option>A4</option><option>Letter</option></select><select aria-label="Orientation" className="rounded-lg border border-slate-700 bg-slate-950 p-2"><option>Landscape</option><option>Portrait</option></select></div></details><button disabled={busy || previewStatus === "generating" || sections.length === 0} onClick={() => void generate()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-xs font-bold text-white shadow-lg shadow-rose-900/20 hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"><FileDown className="w-4 h-4"/>{busy ? "Generating…" : "Generate Report"}</button>{sections.length === 0 && <p className="text-[10px] text-amber-300">Choose at least one section to generate a report.</p>}</section></aside>
    </div>
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-bold text-slate-100">Recent Reports</h2><span className="text-[10px] text-slate-500">Persistent on this device</span></div>{history.length === 0 ? <p className="py-6 text-center text-xs text-slate-500">No reports yet. Choose a report type and generate your first report.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="pb-2">Filename</th><th>Facility</th><th>Month</th><th>Pages</th><th>Created</th><th></th></tr></thead><tbody>{history.map(item => <tr key={item.id} className="border-t border-slate-800 text-slate-300"><td className="py-2 font-medium">{item.filename}</td><td>{item.facility}</td><td>{item.month}</td><td>{item.pages ?? "—"}</td><td>{formatTimestamp(new Date(item.createdAt))}</td><td className="text-right">{item.path && onReveal && <button onClick={() => onReveal(item.path!)} className="mr-2 text-rose-300 hover:text-rose-200">Reveal</button>}<button onClick={() => setHistory(HistoryProvider.remove(item.id))} aria-label={`Delete ${item.filename}`} className="text-slate-500 hover:text-rose-300"><X className="inline w-3.5 h-3.5"/></button></td></tr>)}</tbody></table></div>}</section>
  </div>;
}
