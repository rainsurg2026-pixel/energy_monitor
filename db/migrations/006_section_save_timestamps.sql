-- Energy Monitor Web v3: preserve Desktop per-section save timestamps.
-- The timestamp belongs to the monthly period metadata, not to an individual
-- reading row: one monthly period has exactly one last-save value per Desktop
-- section (UPS, Air, DC and Energy Cost).

ALTER TABLE public.monthly_periods
  ADD COLUMN IF NOT EXISTS last_saved_ups timestamptz,
  ADD COLUMN IF NOT EXISTS last_saved_air timestamptz,
  ADD COLUMN IF NOT EXISTS last_saved_dc timestamptz,
  ADD COLUMN IF NOT EXISTS last_saved_energy_cost timestamptz;

COMMENT ON COLUMN public.monthly_periods.last_saved_ups IS 'Desktop-compatible timestamp for the last UPS section save.';
COMMENT ON COLUMN public.monthly_periods.last_saved_air IS 'Desktop-compatible timestamp for the last Air section save.';
COMMENT ON COLUMN public.monthly_periods.last_saved_dc IS 'Desktop-compatible timestamp for the last DC section save.';
COMMENT ON COLUMN public.monthly_periods.last_saved_energy_cost IS 'Desktop-compatible timestamp for the last Energy Cost section save.';

-- monthly_periods is already protected and granted through migrations 001/002;
-- this additive metadata change introduces no new exposed relation or policy.
