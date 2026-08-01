/**
 * RackCapacityContext - the single owner of the Rack Capacity Reporting
 * Month and of every shared derived value the Rack Capacity page renders.
 *
 * v2.2.5 rule: Summary / Editor / History / Timeline / Forecast / Charts
 * never manage the Reporting Month (or each other's derived data)
 * independently - they all read from this one provider. The provider itself
 * is dumb state + memoized derivation: all month math comes from
 * monthUtils/timelineUtils, all forecasting from capacityForecast, and all
 * status counting from rackCapacity's calculateRackCapacityMetrics - this
 * module never re-implements any of it.
 */
import React, { createContext, useContext, useMemo, useState } from "react";
import type { RackCapacitySummary } from "../../reports/reportTypes";
import type { RackUnitCapacityRow } from "../../excel/RackUnitCapacityWriter";
import type { RackCapacityHistoryRow } from "../../excel/RackCapacityHistoryWriter";
import { RACK_CAPACITY_HISTORY_TOTAL_ZONE } from "../../excel/RackCapacityHistoryWriter";
import { calculateRackCapacityMetrics, RackCapacityMetrics } from "../../utils/rackCapacity";
import { currentMonth, yearOf } from "../../utils/monthUtils";
import { linearRegression, extendWithForecast, RegressionResult, TimeSeriesPoint } from "../../utils/capacityForecast";

export interface RackCapacityContextValue {
  lang: "th" | "en";
  facilityName: string | null;
  /** The one Reporting Month every Rack Capacity view shares. */
  reportingMonth: string;
  setReportingMonth: (month: string) => void;
  /** Raw workbook summary (records + totals), null when the workbook has no
   *  Rack Capacity sheet/table. */
  rackCapacity: RackCapacitySummary | null;
  rackUnitCapacity: RackUnitCapacityRow[];
  rackCapacityHistory: RackCapacityHistoryRow[];
  metrics: RackCapacityMetrics;
  /** The Rack Unit Capacity row for the current reporting month, if saved. */
  unitCapacityRow: RackUnitCapacityRow | null;
  /** Facility-total history rows (RackZone === "(Total)"), newest first. */
  historyTotalRows: RackCapacityHistoryRow[];
  /** Distinct months that have persisted history snapshots, ascending. */
  availableMonths: string[];
  reportingYear: string;
  /** Usage % history (0-100) for the trend/forecast charts. */
  usageHistory: TimeSeriesPoint[];
  /** usageHistory extended with a 12-month regression forecast. */
  usageForecast: TimeSeriesPoint[];
  regression: RegressionResult | null;
  /** The one Rack Zone filter every Rack Capacity view shares (e.g. Zone
   *  Heatmap click -> Rack Capacity Editor filter). Never a per-component
   *  copy. */
  selectedZone: string | null;
  setSelectedZone: (zone: string | null) => void;
}

export interface RackCapacityProviderProps {
  lang: "th" | "en";
  facilityName?: string | null;
  rackCapacity: RackCapacitySummary | null;
  rackUnitCapacity: RackUnitCapacityRow[];
  rackCapacityHistory: RackCapacityHistoryRow[];
  children: React.ReactNode;
}

const RackCapacityContext = createContext<RackCapacityContextValue | undefined>(undefined);

export const RackCapacityProvider: React.FC<RackCapacityProviderProps> = ({
  lang,
  facilityName = null,
  rackCapacity,
  rackUnitCapacity,
  rackCapacityHistory,
  children
}) => {
  const [reportingMonth, setReportingMonth] = useState<string>(() => currentMonth());
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  const metrics = useMemo(() => calculateRackCapacityMetrics(rackCapacity?.records ?? []), [rackCapacity]);

  const unitCapacityRow = useMemo(
    () => rackUnitCapacity.find(row => row.month === reportingMonth) ?? null,
    [rackUnitCapacity, reportingMonth]
  );

  const historyTotalRows = useMemo(
    () =>
      rackCapacityHistory
        .filter(row => row.rackZone === RACK_CAPACITY_HISTORY_TOTAL_ZONE)
        .sort((a, b) => b.snapshotMonth.localeCompare(a.snapshotMonth)),
    [rackCapacityHistory]
  );

  const availableMonths = useMemo(() => {
    const months = new Set(rackCapacityHistory.map(row => row.snapshotMonth));
    return Array.from(months).sort();
  }, [rackCapacityHistory]);

  const usageHistory = useMemo(
    () =>
      historyTotalRows
        .slice()
        .reverse()
        .map(row => ({ month: row.snapshotMonth, value: row.usagePct !== null ? row.usagePct * 100 : 0 })),
    [historyTotalRows]
  );

  const regression = useMemo(() => linearRegression(usageHistory), [usageHistory]);

  const usageForecast = useMemo(() => extendWithForecast(usageHistory, 12), [usageHistory]);

  const value = useMemo<RackCapacityContextValue>(
    () => ({
      lang,
      facilityName,
      reportingMonth,
      setReportingMonth,
      rackCapacity,
      rackUnitCapacity,
      rackCapacityHistory,
      metrics,
      unitCapacityRow,
      historyTotalRows,
      availableMonths,
      reportingYear: yearOf(reportingMonth),
      usageHistory,
      usageForecast,
      regression,
      selectedZone,
      setSelectedZone
    }),
    [
      lang,
      facilityName,
      reportingMonth,
      rackCapacity,
      rackUnitCapacity,
      rackCapacityHistory,
      metrics,
      unitCapacityRow,
      historyTotalRows,
      availableMonths,
      usageHistory,
      usageForecast,
      regression,
      selectedZone
    ]
  );

  return <RackCapacityContext.Provider value={value}>{children}</RackCapacityContext.Provider>;
};

export function useRackCapacity(): RackCapacityContextValue {
  const context = useContext(RackCapacityContext);
  if (context === undefined) {
    throw new Error("useRackCapacity must be used within a RackCapacityProvider");
  }
  return context;
}
