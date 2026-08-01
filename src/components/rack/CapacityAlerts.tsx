/**
 * CapacityAlerts - in-app only (no email/push/notification infrastructure
 * exists in this app, so that's explicitly out of scope). Reuses the exact
 * same thresholds already established for the Capacity Health Gauge/
 * Executive Health Score (Warning >= 75, Critical >= 90 -
 * capacityForecast.getCapacityHealth) rather than inventing new ones.
 *
 * Facility-level alert uses the same weighted Executive Health Score as the
 * KPI tile/Gauge (single source). Per-zone alerts use each zone's own raw
 * In Use utilization % against the same thresholds - zones don't have a
 * weighted score computed elsewhere, so this is deliberately the simpler of
 * the two, not an inconsistency.
 */
import React from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useRackCapacity } from "./RackCapacityContext";
import { formatRatioPercent } from "../../utils/rackCapacity";
import { calculateCapacityHealthScore, utilizationColorHex } from "../../utils/capacityHealth";
import { getCapacityHealth, CapacityHealthLevel } from "../../utils/capacityForecast";

const WARNING_THRESHOLD = 75;
const CRITICAL_THRESHOLD = 90;

interface AlertItem {
  key: string;
  level: CapacityHealthLevel;
  scopeLabel: string;
  detail: string;
  colorHex: string;
}

export const CapacityAlerts: React.FC = () => {
  const { lang, facilityName, metrics } = useRackCapacity();

  const alerts = React.useMemo<AlertItem[]>(() => {
    const items: AlertItem[] = [];

    const facilityScore = calculateCapacityHealthScore({
      usageRatio: metrics.inUse.ratio,
      availabilityRatio: metrics.available.ratio,
      reservedRatio: metrics.reserved.ratio,
      pendingDismantleRatio: metrics.pendingDismantle.ratio
    });
    const facilityLevel = getCapacityHealth(facilityScore, WARNING_THRESHOLD, CRITICAL_THRESHOLD);
    if (facilityLevel !== "Healthy") {
      items.push({
        key: "facility",
        level: facilityLevel,
        scopeLabel: facilityName ?? (lang === "th" ? "ทั้งไซต์" : "Facility-wide"),
        detail:
          lang === "th"
            ? `คะแนนสุขภาพโดยรวม ${facilityScore.toFixed(0)}/100 (การใช้งาน ${formatRatioPercent(metrics.inUse.ratio, 1)})`
            : `Executive Health Score ${facilityScore.toFixed(0)}/100 (usage ${formatRatioPercent(metrics.inUse.ratio, 1)})`,
        colorHex: utilizationColorHex(facilityScore)
      });
    }

    for (const zone of metrics.zoneMetrics) {
      const utilizationPct = zone.inUse.ratio !== null ? zone.inUse.ratio * 100 : null;
      const zoneLevel = getCapacityHealth(utilizationPct ?? 0, WARNING_THRESHOLD, CRITICAL_THRESHOLD);
      if (utilizationPct !== null && zoneLevel !== "Healthy") {
        items.push({
          key: `zone-${zone.zone}`,
          level: zoneLevel,
          scopeLabel: lang === "th" ? `โซน ${zone.zone}` : `Zone ${zone.zone}`,
          detail: lang === "th" ? `การใช้งาน ${formatRatioPercent(zone.inUse.ratio, 1)}` : `Usage ${formatRatioPercent(zone.inUse.ratio, 1)}`,
          colorHex: utilizationColorHex(utilizationPct)
        });
      }
    }

    // Critical first, then Warning; stable within each band.
    return items.sort((a, b) => (a.level === b.level ? 0 : a.level === "Critical" ? -1 : 1));
  }, [facilityName, lang, metrics]);

  if (alerts.length === 0) {
    return (
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
        <p className="text-sm text-slate-300">{lang === "th" ? "ไม่มีการแจ้งเตือนที่ต้องดำเนินการ" : "No active capacity alerts."}</p>
      </section>
    );
  }

  return (
    <section className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4 shadow-sm space-y-2">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-slate-100">{lang === "th" ? `การแจ้งเตือนความจุ (${alerts.length})` : `Capacity Alerts (${alerts.length})`}</h3>
      </div>
      <div className="space-y-1.5">
        {alerts.map(alert => (
          <div key={alert.key} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: alert.colorHex }} />
            <span className="text-xs font-semibold text-slate-200 shrink-0">{alert.scopeLabel}</span>
            <span className="text-xs text-slate-500">{alert.detail}</span>
            <span
              className="ml-auto text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0"
              style={{ color: alert.colorHex, background: `${alert.colorHex}1a`, border: `1px solid ${alert.colorHex}66` }}
            >
              {alert.level === "Critical" ? (lang === "th" ? "วิกฤติ" : "Critical") : (lang === "th" ? "เตือน" : "Warning")}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};
