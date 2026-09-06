import type { AirRecord } from "../types";

export const AIR_METER_DECIMAL_PLACES = 7;

/**
 * Air-energy meters can be read with six or seven decimal places (GWh).
 * Preserve up to seven decimals as the persisted contract so the application
 * stores the value exactly as far as the source meter can display.
 */
export function roundAirMeterReading(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(AIR_METER_DECIMAL_PLACES));
}

export function roundNullableAirMeterReading(value: number | null | undefined): number | null {
  return value === null || value === undefined ? null : roundAirMeterReading(value);
}

export function normalizeAirRecordPrecision(record: AirRecord): AirRecord {
  return {
    ...record,
    eb41a: roundNullableAirMeterReading(record.eb41a),
    eb41b: roundNullableAirMeterReading(record.eb41b),
    eb42a: roundNullableAirMeterReading(record.eb42a),
    eb42b: roundNullableAirMeterReading(record.eb42b),
    ...(record.meters
      ? { meters: Object.fromEntries(Object.entries(record.meters).map(([key, value]) => [key, roundNullableAirMeterReading(value)])) }
      : {})
  };
}
