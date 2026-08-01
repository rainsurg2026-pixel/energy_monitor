/**
 * ZoneHeatmap - one utilization-colored tile per Rack Zone. Color comes
 * exclusively from the shared utilization gradient (capacityHealth.ts) -
 * same scale as the KPI cards/donut/gauge/PDF. Clicking a zone sets the
 * single shared RackCapacityContext selectedZone, which the Rack Capacity
 * Editor below reads directly - never a local/duplicated filter.
 */
import React from "react";
import { Grid3x3 } from "lucide-react";
import { useRackCapacity } from "./RackCapacityContext";
import { formatRatioPercent } from "../../utils/rackCapacity";
import { utilizationColorHex } from "../../utils/capacityHealth";
import { getAccessibleTextColor } from "../../utils/colorContrast";

export const RACK_CAPACITY_EDITOR_ANCHOR_ID = "rack-capacity-editor-section";

export const ZoneHeatmap: React.FC = () => {
  const { lang, metrics, selectedZone, setSelectedZone } = useRackCapacity();

  const selectZone = (zone: string) => {
    setSelectedZone(selectedZone === zone ? null : zone);
    document.getElementById(RACK_CAPACITY_EDITOR_ANCHOR_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (metrics.zoneMetrics.length === 0) return null;

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 text-slate-200 mb-1">
        <Grid3x3 className="w-4 h-4" />
        <h3 className="text-base">{lang === "th" ? "แผนที่ความร้อนตามโซน" : "Zone Heatmap"}</h3>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        {lang === "th" ? "คลิกโซนเพื่อกรองในตัวแก้ไขความจุแร็คด้านล่าง" : "Click a zone to filter the Rack Capacity Editor below."}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {metrics.zoneMetrics.map(zone => {
          const utilizationPct = zone.inUse.ratio !== null ? zone.inUse.ratio * 100 : null;
          const bg = utilizationColorHex(utilizationPct);
          const textColor = getAccessibleTextColor(bg);
          const active = selectedZone === zone.zone;
          return (
            <button
              key={zone.zone}
              type="button"
              onClick={() => selectZone(zone.zone)}
              className={`rounded-xl p-3 text-left transition-transform hover:scale-[1.02] ${active ? "ring-2 ring-indigo-400" : ""}`}
              style={{ background: bg, color: textColor }}
            >
              <p className="text-sm font-semibold">{zone.zone}</p>
              <p className="text-lg font-mono font-bold mt-1">{formatRatioPercent(zone.inUse.ratio, 0)}</p>
              <p className="text-[10px] opacity-90 mt-1">
                {lang === "th" ? `${zone.total} แร็ค · ว่าง ${formatRatioPercent(zone.available.ratio, 0)}` : `${zone.total} racks · avail ${formatRatioPercent(zone.available.ratio, 0)}`}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
};
