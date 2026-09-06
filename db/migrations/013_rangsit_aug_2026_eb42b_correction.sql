-- Correct the confirmed Rangsit Aug-2026 EB42B source reading.
-- The UI previously displayed six decimals while retaining the older hidden
-- seven-decimal value. The operator confirmed the recorded meter value was
-- 9.325173. Restrict the repair to the exact legacy value so the migration is
-- idempotent and does not touch legitimate seven-decimal readings.

UPDATE air_meter_readings AS reading
SET reading = 9.325173,
    raw_inputs = jsonb_set(
      COALESCE(reading.raw_inputs, '{}'::jsonb),
      '{reading}',
      to_jsonb(9.325173::numeric),
      true
    )
FROM monthly_periods AS period, sites AS site, air_meters AS meter
WHERE reading.period_id = period.id
  AND reading.site_id = site.id
  AND reading.meter_id = meter.id
  AND period.period_month = DATE '2026-08-01'
  AND lower(meter.code) = 'eb42b'
  AND (lower(site.name) = 'rangsit' OR lower(site.code) IN ('rangsit', 'rst'))
  AND reading.reading = 9.3251728;
