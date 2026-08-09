/**
 * ExecutiveKpiCards - the top-of-page Total Racks + per-status + Usage% /
 * Availability% / Trend KPI row. Counts/ratios come exclusively from
 * RackCapacityContext's metrics (calculateRackCapacityMetrics via
 * statusRatio) and usageHistory (trendCalculator) - this module never
 * re-derives them.
 */
import React from "react";
import { useRackCapacity } from "./RackCapacityContext";
import { formatRatioPercent, RACK_CANONICAL_STATUSES, statusRatio } from "../../utils/rackCapacity";
import { rackStatusColorForRatio, rackStatusLabel } from "../../utils/rackStatusConfig";
import { calculatePercentageDelta, getTrendDirection, getTrendLabel } from "../../utils/trendCalculator";
import { calculateCapacityHealthScore, getHealthLabel, utilizationColorHex } from "../../utils/capacityHealth";
import { getCapacityHealth } from "../../utils/capacityForecast";
import { formatFixedNumber, formatFixedPercentage } from "../../utils/numberFormatBridge";

interface KpiTileProps {
  label: string;
  value: string;
  subLabel: string;
  colorHex: string;
}

const KpiTile: React.FC<KpiTileProps> = ({ label, value, subLabel, colorHex }) => (
  <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-sm">
    <span className="absolute inset-y-0 left-0 w-1" style={{ background: colorHex }} />
    <p className="text-xs text-slate-400">{label}</p>
    <p className="mt-1 text-2xl font-mono" style={{ color: colorHex }}>{value}</p>
    <p className="text-xs text-slate-500 font-mono">{subLabel}</p>
  </div>
);

export const ExecutiveKpiCards: React.FC = () => {
  const { lang, metrics, usageHistory } = useRackCapacity();

  const trend = React.useMemo(() => {
    if (usageHistory.length < 2) return null;
    const current = usageHistory[usageHistory.length - 1].value;
    const previous = usageHistory[usageHistory.length - 2].value;
    const pct = calculatePercentageDelta(current, previous);
    return { pct, direction: getTrendDirection(pct) };
  }, [usageHistory]);

  const trendColor =
    trend === null ? "#94a3b8" : trend.direction === "Up" ? "#f97316" : trend.direction === "Down" ? "#22c55e" : "#94a3b8";

  // Same single source the Capacity Health Gauge uses - never a second
  // calculation of the score.
  const healthScore = React.useMemo(
    () =>
      calculateCapacityHealthScore({
        usageRatio: metrics.inUse.ratio,
        availabilityRatio: metrics.available.ratio,
        reservedRatio: metrics.reserved.ratio,
        pendingDismantleRatio: metrics.pendingDismantle.ratio
      }),
    [metrics]
  );
  const healthLevel = getCapacityHealth(healthScore, 75, 90);
  const healthColor = utilizationColorHex(healthScore);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-9 gap-3">
      <KpiTile
        label={lang === "th" ? "คะแนนสุขภาพโดยรวม" : "Executive Health Score"}
        value={`${formatFixedNumber(healthScore, 0)}/100`}
        subLabel={getHealthLabel(healthLevel, lang)}
        colorHex={healthColor}
      />
      <KpiTile
        label={lang === "th" ? "แร็คทั้งหมด" : "Total Racks"}
        value={String(metrics.total)}
        subLabel={formatRatioPercent(metrics.total > 0 ? 1 : null)}
        colorHex="#64748b"
      />
      {RACK_CANONICAL_STATUSES.map(status => {
        const { count, ratio } = statusRatio(metrics, status);
        const hex = rackStatusColorForRatio(status, ratio);
        return (
          <KpiTile key={status} label={rackStatusLabel(status, lang)} value={String(count)} subLabel={formatRatioPercent(ratio)} colorHex={hex} />
        );
      })}
      <KpiTile
        label={lang === "th" ? "อัตราการใช้งาน %" : "Usage %"}
        value={formatRatioPercent(metrics.inUse.ratio, 1)}
        subLabel={lang === "th" ? "ใช้แล้ว / ทั้งหมด" : "used / total"}
        colorHex={rackStatusColorForRatio("In Use", metrics.inUse.ratio)}
      />
      <KpiTile
        label={lang === "th" ? "อัตราว่าง %" : "Availability %"}
        value={formatRatioPercent(metrics.available.ratio, 1)}
        subLabel={lang === "th" ? "ว่าง / ทั้งหมด" : "available / total"}
        colorHex="#22c55e"
      />
      <KpiTile
        label={lang === "th" ? "แนวโน้มจากเดือนก่อน" : "Trend vs Prev Month"}
        value={trend === null ? "—" : `${trend.direction === "Up" ? "▲" : trend.direction === "Down" ? "▼" : "◆"} ${formatFixedPercentage(Math.abs(trend.pct), 1)}`}
        subLabel={trend === null ? (lang === "th" ? "ไม่มีข้อมูลเพียงพอ" : "not enough history") : getTrendLabel(trend.direction, lang)}
        colorHex={trendColor}
      />
    </div>
  );
};
