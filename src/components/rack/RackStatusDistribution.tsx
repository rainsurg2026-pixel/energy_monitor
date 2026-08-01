import React from "react";
import { useRackCapacity } from "./RackCapacityContext";
import { RACK_STATUS_DISPLAY_ORDER, rackStatusColorForRatio, rackStatusLabel } from "../../utils/rackStatusConfig";
import RackStatusBar from "./RackStatusBar";
import { formatRatioPercent, statusRatio } from "../../utils/rackCapacity";

export const RackStatusDistribution: React.FC = () => {
  const { lang, metrics } = useRackCapacity();

  const visibleStatuses = RACK_STATUS_DISPLAY_ORDER.filter(status => statusRatio(metrics, status).count > 0);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
      <h3 className="text-base text-slate-100 mb-4">{lang === "th" ? "การกระจายสถานะแร็ค" : "Rack Status Distribution"}</h3>
      <div className="space-y-3">
        {visibleStatuses.map(status => {
          const { count, ratio } = statusRatio(metrics, status);
          const hex = rackStatusColorForRatio(status, ratio);
          return (
            <div key={status} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: hex }} />
                  {rackStatusLabel(status, lang)}
                </span>
                <span className="font-mono text-slate-400 shrink-0">
                  {count} · {formatRatioPercent(ratio)}
                </span>
              </div>
              <RackStatusBar ratio={ratio} colorHex={hex} />
            </div>
          );
        })}
      </div>
    </section>
  );
};
