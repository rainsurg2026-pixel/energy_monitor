import { useMemo, useState } from "react";
import type { RackCapacityHistoryRow } from "../excel/RackCapacityHistoryWriter";
import { RACK_CAPACITY_HISTORY_TOTAL_ZONE } from "../excel/RackCapacityHistoryWriter";
import { formatRatioPercent } from "../utils/rackCapacity";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { History } from "lucide-react";

interface RackCapacityHistoryPanelProps {
  rows: RackCapacityHistoryRow[];
  lang: "th" | "en";
}

type RangeMonths = 3 | 6 | 12;

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const monthIndex = ((total % 12) + 12) % 12;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function displayMonth(month: string, lang: "th" | "en"): string {
  const [y, m] = month.split("-").map(Number);
  const names = lang === "th"
    ? ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[m - 1]}-${String(y).slice(2)}`;
}

export default function RackCapacityHistoryPanel({ rows, lang }: RackCapacityHistoryPanelProps) {
  const totalRows = useMemo(
    () => rows.filter(r => r.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE).sort((a, b) => a.snapshotMonth.localeCompare(b.snapshotMonth)),
    [rows]
  );
  const availableMonths = useMemo(() => totalRows.map(r => r.snapshotMonth), [totalRows]);
  const [referenceMonth, setReferenceMonth] = useState<string>(() => availableMonths.at(-1) ?? "");
  const [range, setRange] = useState<RangeMonths>(3);

  const effectiveReference = referenceMonth || availableMonths.at(-1) || "";

  const rangeMonths = useMemo(() => {
    if (!effectiveReference) return [];
    const months: string[] = [];
    for (let i = range - 1; i >= 0; i--) months.push(shiftMonth(effectiveReference, -i));
    return months;
  }, [effectiveReference, range]);

  const rowsByMonth = useMemo(() => new Map(totalRows.map(r => [r.snapshotMonth, r])), [totalRows]);

  const chartData = useMemo(
    () => rangeMonths.map(month => {
      const row = rowsByMonth.get(month);
      return {
        month: displayMonth(month, lang),
        usage: row?.usagePct !== null && row?.usagePct !== undefined ? Number((row.usagePct * 100).toFixed(2)) : null,
        availability: row?.availabilityPct !== null && row?.availabilityPct !== undefined ? Number((row.availabilityPct * 100).toFixed(2)) : null
      };
    }),
    [rangeMonths, rowsByMonth, lang]
  );

  if (availableMonths.length === 0) {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 text-slate-200 mb-2"><History className="w-4 h-4" /><h3 className="text-base">{lang === "th" ? "ประวัติความจุแร็ครายเดือน" : "Rack Capacity Monthly History"}</h3></div>
        <p className="text-sm text-slate-500">
          {lang === "th"
            ? "ยังไม่มีข้อมูลประวัติ ระบบจะบันทึกสแนปช็อตอัตโนมัติเมื่อมีการบันทึกการเปลี่ยนแปลงความจุแร็คครั้งถัดไป"
            : "No history yet. A snapshot is recorded automatically the next time Rack Capacity changes are saved."}
        </p>
      </section>
    );
  }

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 text-slate-200"><History className="w-4 h-4" /><h3 className="text-base">{lang === "th" ? "ประวัติความจุแร็ครายเดือน" : "Rack Capacity Monthly History"}</h3></div>
        <div className="flex items-center gap-2">
          <select value={effectiveReference} onChange={e => setReferenceMonth(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200">
            {availableMonths.map(month => <option key={month} value={month}>{displayMonth(month, lang)}</option>)}
          </select>
          {([3, 6, 12] as RangeMonths[]).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${range === r ? "bg-indigo-600 text-white" : "bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200"}`}
            >
              {r}M
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs border-collapse">
            <thead>
              <tr className="bg-slate-950/50 text-left">
                <th className="py-2 px-4">{lang === "th" ? "เดือน" : "Month"}</th>
                <th className="py-2 px-4 text-right">{lang === "th" ? "แร็คทั้งหมด" : "Total Racks"}</th>
                <th className="py-2 px-4 text-right">{lang === "th" ? "ใช้งานอยู่" : "In Use"}</th>
                <th className="py-2 px-4 text-right">{lang === "th" ? "ว่าง" : "Available"}</th>
                <th className="py-2 px-4 text-right">{lang === "th" ? "จองไว้" : "Reserved"}</th>
                <th className="py-2 px-4 text-right">{lang === "th" ? "รอถอดถอน" : "Pending Dismantle"}</th>
              </tr>
            </thead>
            <tbody>
              {rangeMonths.map(month => {
                const row = rowsByMonth.get(month);
                return (
                  <tr key={month} className="border-t border-slate-800">
                    <td className="py-2 px-4">{displayMonth(month, lang)}</td>
                    {row ? (
                      <>
                        <td className="py-2 px-4 text-right font-mono">{row.totalRacks}</td>
                        <td className="py-2 px-4 text-right font-mono">{row.inUse} ({formatRatioPercent(row.usagePct)})</td>
                        <td className="py-2 px-4 text-right font-mono">{row.available} ({formatRatioPercent(row.availabilityPct)})</td>
                        <td className="py-2 px-4 text-right font-mono">{row.reserved} ({formatRatioPercent(row.reservedPct)})</td>
                        <td className="py-2 px-4 text-right font-mono">{row.pendingDismantle} ({formatRatioPercent(row.pendingDismantlePct)})</td>
                      </>
                    ) : (
                      <td className="py-2 px-4 text-slate-600" colSpan={5}>{lang === "th" ? "ไม่มีข้อมูล" : "gap — no snapshot"}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {totalRows.length < 2 ? (
        <p className="text-xs text-slate-500">
          {lang === "th" ? "มีข้อมูลประวัติเพียงเดือนเดียว ยังไม่แสดงกราฟแนวโน้ม" : "Only one month of history exists — a trend needs at least two months to be meaningful."}
        </p>
      ) : (
        <div className="h-56">
          <p className="text-sm text-slate-300 mb-2">{lang === "th" ? "แนวโน้มความจุแร็ครายเดือน" : "Rack Capacity Monthly Trend"}</p>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} unit="%" domain={[0, 100]} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} formatter={(value: number) => `${value}%`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="usage" name={lang === "th" ? "อัตราการใช้งาน %" : "Usage %"} stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
              <Line type="monotone" dataKey="availability" name={lang === "th" ? "อัตราว่าง %" : "Availability %"} stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
