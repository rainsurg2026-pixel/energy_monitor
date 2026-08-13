/**
 * RackUnitCapacitySummary - the "Rack Unit Capacity and Utilization"
 * Executive Summary: READ ONLY, distinct from the RackUnitCapacityPanel
 * editor below it on the page. Numeric stats read exclusively from
 * RackCapacityContext; the monthly image is fetched on demand from the
 * filesystem ImageStorageProvider (src/storage/ImageStorageProvider.ts) for
 * exactly the selected Reporting Month, never today's date and never a
 * fallback to the latest/nearest month.
 *
 * Layout (v2.2.6 redesign): Rack Unit Capacity Cards occupy ~60% width,
 * the Monthly Rack Unit Capacity Image ~40%, per the release spec. The
 * donut stays paired with the cards (Rack Unit Capacity has no zone
 * dimension to summarize - Total(U)/Used(U)/Available(U) are the complete,
 * real data model, so the donut's own center label is the summary, rather
 * than fabricating zone data that does not exist for this metric).
 */
import React from "react";
import { ImagePlus, Boxes } from "lucide-react";
import type { RackUnitCapacityRow } from "../../excel/RackUnitCapacityWriter";
import type { IDataProvider } from "../../data/IDataProvider";
import type { StoredImageMeta } from "../../desktop";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { useRackCapacity } from "./RackCapacityContext";
import { formatRatioPercent } from "../../utils/rackCapacity";
import { monthLabelLong, monthLabelShort, shiftMonth } from "../../utils/monthUtils";
import { calculatePercentageDelta, getTrendDirection, getTrendLabel } from "../../utils/trendCalculator";
import { utilizationColorHex } from "../../utils/capacityHealth";
import { formatTimestamp } from "../../utils";
import { findPreviousRackUnitCapacityRow } from "../../utils/rackUnitCapacity";
import { formatFixedPercentage } from "../../utils/numberFormatBridge";

const TREND_MONTHS = 12;

/** `refreshKey` bumps whenever an image is saved anywhere on the page
 *  (RackUnitCapacityPanel's onImageHistorySaved), forcing a re-fetch for
 *  the currently selected month even though reportingMonth itself didn't
 *  change. */
export const RackUnitCapacitySummary: React.FC<{ provider: IDataProvider; refreshKey?: number }> = ({ provider, refreshKey }) => {
  const { lang, facilityName, reportingMonth, rackUnitCapacity, unitCapacityRow } = useRackCapacity();

  const [imageDataUri, setImageDataUri] = React.useState<string | null>(null);
  const [imageMeta, setImageMeta] = React.useState<StoredImageMeta | null>(null);
  const [imageLoading, setImageLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    if (!facilityName || !provider.getRackUnitCapacityImage) {
      setImageDataUri(null);
      setImageMeta(null);
      return;
    }
    setImageLoading(true);
    provider.getRackUnitCapacityImage(facilityName, reportingMonth)
      .then(result => {
        if (cancelled) return;
        setImageDataUri(result?.dataUri ?? null);
        setImageMeta(result?.meta ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setImageDataUri(null);
          setImageMeta(null);
        }
      })
      .finally(() => {
        if (!cancelled) setImageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, facilityName, reportingMonth, refreshKey]);

  const sortedRows = React.useMemo(() => [...rackUnitCapacity].sort((a, b) => a.month.localeCompare(b.month)), [rackUnitCapacity]);

  const previousRow = React.useMemo(
    () => findPreviousRackUnitCapacityRow(rackUnitCapacity, reportingMonth),
    [rackUnitCapacity, reportingMonth]
  );

  const usagePctNow = unitCapacityRow && unitCapacityRow.totalU > 0 ? (unitCapacityRow.usedU / unitCapacityRow.totalU) * 100 : null;
  const usagePctPrev = previousRow && previousRow.totalU > 0 ? (previousRow.usedU / previousRow.totalU) * 100 : null;

  const trend = React.useMemo(() => {
    if (usagePctNow === null || usagePctPrev === null) return null;
    const pct = calculatePercentageDelta(usagePctNow, usagePctPrev);
    return { pct, direction: getTrendDirection(pct, 0.05) };
  }, [usagePctNow, usagePctPrev]);

  const donutData = unitCapacityRow
    ? [
        { name: "used", value: unitCapacityRow.usedU },
        { name: "available", value: Math.max(0, unitCapacityRow.availableU) }
      ]
    : [];

  const trendChartData = React.useMemo(() => {
    const months: string[] = [];
    for (let i = TREND_MONTHS - 1; i >= 0; i--) months.push(shiftMonth(reportingMonth, -i));
    const byMonth = new Map<string, RackUnitCapacityRow>(sortedRows.map(r => [r.month, r] as const));
    return months.map(month => {
      const row = byMonth.get(month);
      return {
        month: monthLabelShort(month, lang),
        used: row ? row.usedU : null,
        available: row ? row.availableU : null,
        total: row ? row.totalU : null
      };
    });
  }, [sortedRows, reportingMonth, lang]);

  const usageColor = utilizationColorHex(usagePctNow);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm space-y-5">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400"><Boxes className="w-5 h-5" /></div>
        <div>
          <h3 className="text-base text-slate-100">
            {lang === "th" ? "ความจุหน่วยแร็คและการใช้งาน" : "Rack Unit Capacity and Utilization"} — <span className="font-mono text-emerald-400">{monthLabelLong(reportingMonth, lang)}</span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">{lang === "th" ? "ภาพรวมความจุหน่วยแร็ค (U) แบบอ่านอย่างเดียว" : "Read-only Rack Unit Capacity (U) executive summary"}</p>
        </div>
      </div>

      {!unitCapacityRow ? (
        <p className="text-sm text-slate-500">
          {lang === "th" ? "ไม่มีข้อมูลความจุหน่วยแร็ค (U) สำหรับเดือนที่เลือก" : "No Rack Unit Capacity (U) data for the selected month."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-stretch">
            {/* Rack Unit Capacity Cards - ~60% width */}
            <div className="lg:col-span-3 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: lang === "th" ? "ทั้งหมด (U)" : "Total (U)", value: String(unitCapacityRow.totalU) },
                  { label: lang === "th" ? "ใช้แล้ว (U)" : "Used (U)", value: String(unitCapacityRow.usedU) },
                  { label: lang === "th" ? "ว่าง (U)" : "Available (U)", value: String(unitCapacityRow.availableU) },
                  { label: lang === "th" ? "% ความจุที่ว่าง" : "Availability %", value: formatRatioPercent(unitCapacityRow.availabilityPct) },
                  { label: lang === "th" ? "% การใช้งาน" : "Usage %", value: usagePctNow === null ? "—" : formatFixedPercentage(usagePctNow, 1) },
                  {
                    label: lang === "th" ? "แนวโน้มจากเดือนก่อน" : "Trend vs Prev Month",
                    value: trend === null ? "—" : `${trend.direction === "Up" ? "▲" : trend.direction === "Down" ? "▼" : "◆"} ${formatFixedPercentage(Math.abs(trend.pct), 1)}`,
                    caption: trend === null ? (lang === "th" ? "ไม่มีข้อมูลเดือนก่อน" : "no prior month") : getTrendLabel(trend.direction, lang)
                  }
                ].map(item => (
                  <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 shadow-sm">
                    <p className="text-[11px] text-slate-500">{item.label}</p>
                    <p className="mt-1 text-lg font-mono text-slate-100">{item.value}</p>
                    {"caption" in item && <p className="text-[10px] text-slate-600 mt-0.5">{item.caption}</p>}
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 flex items-center gap-4">
                <div className="relative w-36 h-36 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                        <Cell fill={usageColor} />
                        <Cell fill="#1e293b" />
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-mono font-semibold text-slate-100">{unitCapacityRow.usedU} / {unitCapacityRow.totalU}</span>
                    <span className="text-[9px] uppercase tracking-wide text-slate-500">{lang === "th" ? "ใช้แล้ว / ทั้งหมด (U)" : "Used / Total (U)"}</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 text-slate-300"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: usageColor }} />{lang === "th" ? "ใช้แล้ว (U)" : "Used (U)"}</span>
                    <span className="font-mono text-slate-100">{unitCapacityRow.usedU}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-1.5 text-slate-300"><i className="w-2.5 h-2.5 rounded-full inline-block bg-slate-700" />{lang === "th" ? "ว่าง (U)" : "Available (U)"}</span>
                    <span className="font-mono text-slate-100">{unitCapacityRow.availableU}</span>
                  </div>
                  <div className="pt-1 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-400">{lang === "th" ? "รวม (U)" : "Total (U)"}</span>
                    <span className="font-mono text-slate-200">{unitCapacityRow.totalU}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Monthly Rack Unit Capacity Image - ~40% width */}
            <div className="lg:col-span-2">
              <p className="text-xs text-slate-400 mb-2">{lang === "th" ? "รูปภาพความจุหน่วยแร็คประจำเดือน" : "Monthly Rack Unit Capacity Image"}</p>
              {imageLoading ? (
                <div className="w-full h-64 flex items-center justify-center rounded-xl border-2 border-dashed border-slate-800 bg-slate-950/40 text-slate-600">
                  <p className="text-[11px]">{lang === "th" ? "กำลังโหลด…" : "Loading…"}</p>
                </div>
              ) : imageDataUri ? (
                <figure className="relative w-full h-64 rounded-xl border border-slate-800 shadow-md overflow-hidden bg-slate-950">
                  <img src={imageDataUri} alt="Rack Unit Capacity" className="w-full h-full object-contain" />
                  <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 via-slate-950/70 to-transparent px-3 pt-6 pb-2.5 space-y-0.5">
                    <p className="text-[11px] font-medium text-slate-100">{monthLabelLong(reportingMonth, lang)}</p>
                    <div className="flex flex-wrap gap-x-3 text-[10px] text-slate-300">
                      {imageMeta && (
                        <>
                          <span>{lang === "th" ? "อัปเดตล่าสุด" : "Last Updated"}: {formatTimestamp(new Date(imageMeta.savedAt))}</span>
                          <span>{lang === "th" ? "ความละเอียด" : "Resolution"}: {imageMeta.width}×{imageMeta.height}px</span>
                          <span>{lang === "th" ? "บันทึกโดย" : "Captured By"}: {imageMeta.savedBy}</span>
                        </>
                      )}
                    </div>
                  </figcaption>
                </figure>
              ) : (
                <div className="w-full h-64 flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-slate-800 bg-slate-950/40 text-slate-500">
                  <div className="p-3 rounded-full bg-slate-900 border border-slate-800">
                    <ImagePlus className="w-6 h-6" />
                  </div>
                  <p className="text-xs text-slate-400">{lang === "th" ? "ยังไม่มีรูปภาพความจุหน่วยแร็คประจำเดือนนี้" : "Rack Unit Capacity image not yet captured"}</p>
                  <p className="text-[10px] text-slate-600 text-center px-6">{lang === "th" ? "อัปโหลดได้ที่แผงแก้ไขด้านล่าง" : "Upload one from the editor panel below"}</p>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="text-sm text-slate-300 mb-2">{lang === "th" ? `แนวโน้มความจุหน่วยแร็ค ${TREND_MONTHS} เดือน` : `${TREND_MONTHS}-Month Rack Unit Capacity Trend`}</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="month" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="used" name={lang === "th" ? "ใช้แล้ว (U)" : "Used (U)"} stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="available" name={lang === "th" ? "ว่าง (U)" : "Available (U)"} stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                  <Line type="monotone" dataKey="total" name={lang === "th" ? "ทั้งหมด (U)" : "Total (U)"} stroke="#64748b" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
