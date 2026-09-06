import type { AirRecord } from "../types";

export const AIR_METER_DECIMAL_PLACES = 6;

/**
 * Air-energy meters are entered and displayed to six decimal places (GWh).
 * Keep that precision as the persisted/calculation contract so hidden binary
 * floating-point residue or legacy 7+ decimal values cannot change reports.
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
