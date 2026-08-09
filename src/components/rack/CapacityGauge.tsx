/**
 * CapacityGauge - the Executive Capacity Health Gauge. Utilization source:
 * the saved Rack Unit Capacity row for the shared Reporting Month (used U /
 * total U), falling back to rack-count In Use % when no unit row exists.
 * The 0-100 health score blends usage/availability/reserved/pending
 * (capacityHealth.calculateCapacityHealthScore) - color/label come
 * exclusively from capacityHealth + capacityForecast, never re-derived here.
 */
import React from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useRackCapacity } from "./RackCapacityContext";
import { getCapacityHealth } from "../../utils/capacityForecast";
import { calculateCapacityHealthScore, getHealthLabel, utilizationColorHex } from "../../utils/capacityHealth";
import { formatRatioPercent } from "../../utils/rackCapacity";
import { formatFixedNumber, formatFixedPercentage } from "../../utils/numberFormatBridge";

export const CapacityGauge: React.FC = () => {
  const { lang, metrics, unitCapacityRow } = useRackCapacity();

  const utilization = React.useMemo(() => {
    if (unitCapacityRow && unitCapacityRow.totalU > 0) return (unitCapacityRow.usedU / unitCapacityRow.totalU) * 100;
    if (metrics.inUse.ratio !== null) return metrics.inUse.ratio * 100;
    return 0;
  }, [unitCapacityRow, metrics]);

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

  const health = getCapacityHealth(healthScore, 75, 90);
  const color = utilizationColorHex(healthScore);
  const data = [
    { name: "Used", value: utilization },
    { name: "Free", value: Math.max(0, 100 - utilization) }
  ];

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
      <h3 className="text-base text-slate-100 mb-2">{lang === "th" ? "เกจสุขภาพความจุ" : "Capacity Health Gauge"}</h3>
      <div className="relative h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="none"
            >
              <Cell fill={color} />
              <Cell fill="#1e293b" />
            </Pie>
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} formatter={(value: number) => formatFixedPercentage(value, 1)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="text-3xl font-mono font-semibold" style={{ color }}>{formatFixedPercentage(utilization, 1)}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">{getHealthLabel(health, lang)}</span>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mt-2 font-mono">
        {lang === "th" ? `คะแนนสุขภาพ (ถ่วงน้ำหนัก): ${formatFixedNumber(healthScore, 0)}/100` : `Weighted Health Score: ${formatFixedNumber(healthScore, 0)}/100`}
      </p>
      <p className="text-[11px] text-slate-600 mt-1">
        {unitCapacityRow
          ? lang === "th"
            ? `จากหน่วยแร็ค (U) ที่บันทึก: ใช้แล้ว ${unitCapacityRow.usedU} / ทั้งหมด ${unitCapacityRow.totalU}`
            : `From saved Rack Unit Capacity: ${unitCapacityRow.usedU} / ${unitCapacityRow.totalU} U used`
          : lang === "th"
            ? `จากจำนวนแร็คที่ใช้งาน: ${metrics.inUse.count} จากทั้งหมด ${metrics.total} (${formatRatioPercent(metrics.inUse.ratio)})`
            : `From rack counts in use: ${metrics.inUse.count} of ${metrics.total} (${formatRatioPercent(metrics.inUse.ratio)})`}
      </p>
    </section>
  );
};
