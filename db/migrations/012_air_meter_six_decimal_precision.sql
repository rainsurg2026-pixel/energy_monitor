-- Air-conditioning energy meters entered or edited by users are limited to six decimal places (GWh).
-- Preserve legacy/imported historical precision so historical calculations remain source-faithful.

CREATE OR REPLACE FUNCTION enforce_air_meter_six_decimal_precision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reading IS NOT NULL THEN
    NEW.reading := ROUND(NEW.reading, 6);
    NEW.raw_inputs := jsonb_set(
      COALESCE(NEW.raw_inputs, '{}'::jsonb),
      '{reading}',
      to_jsonb(ROUND(NEW.reading, 6)),
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS air_meter_six_decimal_precision ON air_meter_readings;
CREATE TRIGGER air_meter_six_decimal_precision
BEFORE INSERT OR UPDATE OF reading ON air_meter_readings
FOR EACH ROW
EXECUTE FUNCTION enforce_air_meter_six_decimal_precision();
