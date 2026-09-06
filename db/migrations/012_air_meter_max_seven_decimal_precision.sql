-- Air-conditioning energy meters may be read with six or seven decimal places (GWh).
-- Preserve source precision up to seven decimals and reject any hidden precision beyond that.

ALTER TABLE air_meter_readings
  ALTER COLUMN reading TYPE numeric(20,7)
  USING ROUND(reading, 7);

DROP TRIGGER IF EXISTS air_meter_six_decimal_precision ON air_meter_readings;
DROP TRIGGER IF EXISTS air_meter_max_seven_decimal_precision ON air_meter_readings;
DROP FUNCTION IF EXISTS enforce_air_meter_six_decimal_precision();

CREATE OR REPLACE FUNCTION enforce_air_meter_max_seven_decimal_precision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reading IS NOT NULL THEN
    NEW.reading := ROUND(NEW.reading, 7);
    NEW.raw_inputs := jsonb_set(
      COALESCE(NEW.raw_inputs, '{}'::jsonb),
      '{reading}',
      to_jsonb(ROUND(NEW.reading, 7)),
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER air_meter_max_seven_decimal_precision
BEFORE INSERT OR UPDATE OF reading ON air_meter_readings
FOR EACH ROW
EXECUTE FUNCTION enforce_air_meter_max_seven_decimal_precision();
