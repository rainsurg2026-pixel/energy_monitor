-- Air-conditioning energy meters are entered to six decimal places (GWh).
-- Normalize legacy rows first, then make the database enforce the same scale.
UPDATE air_meter_readings
SET
  reading = ROUND(reading, 6),
  raw_inputs = jsonb_set(
    COALESCE(raw_inputs, '{}'::jsonb),
    '{reading}',
    to_jsonb(ROUND(reading, 6)),
    true
  )
WHERE reading IS NOT NULL
  AND reading <> ROUND(reading, 6);

ALTER TABLE air_meter_readings
  ALTER COLUMN reading TYPE numeric(20,6)
  USING ROUND(reading, 6);
