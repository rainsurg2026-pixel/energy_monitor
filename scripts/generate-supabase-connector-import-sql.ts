import { readWorkbookSource } from "../server/migration/workbookSource";
import { createMigrationPlan } from "../server/migration/engine";

const [siteCode, sourcePath] = process.argv.slice(2);
if (!siteCode || !sourcePath) throw new Error("Usage: node --import tsx scripts/generate-supabase-connector-import-sql.ts <site-code> <workbook-path>");

const source = await readWorkbookSource(sourcePath);
const plan = createMigrationPlan(source, { siteCode });
if (plan.issues.some(issue => issue.severity === "error")) throw new Error("Migration plan contains validation errors; connector SQL was not generated.");

const payload = Buffer.from(JSON.stringify(plan), "utf8").toString("base64");
const sql = String.raw`DO $do$
DECLARE
  v_payload jsonb := convert_from(decode('__PAYLOAD__', 'base64'), 'UTF8')::jsonb;
  v_source jsonb := v_payload->'source';
  v_mapping jsonb := v_payload->'mapping';
  v_existing_id bigint;
  v_existing_status text;
  v_site_id bigint;
  v_site_name text;
  v_site_active boolean;
  v_profile_code text;
  v_batch_id bigint;
  v_period_id bigint;
  v_device_id bigint;
  v_meter_id bigint;
  v_panel_id bigint;
  v_snapshot_id bigint;
  v_run_id bigint;
  v_month text;
  v_source_hash text;
  v_site_code text;
  v_source_sheet text;
  v_source_location text;
  v_numeric numeric;
  v_calc jsonb;
  v_metric jsonb;
  v_log jsonb;
  v_ups jsonb;
  v_phase jsonb;
  v_dc jsonb;
  v_air_values jsonb;
  v_air_value jsonb;
  v_meter_value jsonb;
  v_sri jsonb;
  v_rack_record jsonb;
  v_rack_unit jsonb;
  v_key text;
  v_value jsonb;
  v_meter_key text;
  v_period_ids bigint[] := ARRAY[]::bigint[];
  v_rack_unit_months date[] := ARRAY[]::date[];
  v_expected_logs integer := 0;
  v_expected_evidence integer := 0;
  v_expected_rack_records integer := 0;
  v_expected_rack_units integer := 0;
  v_ups_count integer := 0;
  v_air_count integer := 0;
  v_dc_count integer := 0;
  v_electrical_count integer := 0;
  v_energy_count integer := 0;
  v_rack_record_count integer := 0;
  v_rack_unit_count integer := 0;
  v_actual_count bigint;
BEGIN
  v_source_hash := v_source->>'sourceFileHash';
  v_site_code := v_mapping->>'siteCode';
  v_expected_logs := jsonb_array_length(COALESCE(v_source->'logs', '[]'::jsonb));
  v_expected_evidence := jsonb_array_length(COALESCE(v_source->'cachedEvidence', '[]'::jsonb));
  v_expected_rack_units := jsonb_array_length(COALESCE(v_source->'rackUnitCapacityRows', '[]'::jsonb));
  IF jsonb_typeof(v_source->'rackCapacitySnapshot') = 'object' THEN
    v_expected_rack_records := jsonb_array_length(COALESCE(v_source->'rackCapacitySnapshot'->'records', '[]'::jsonb));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_payload->'issues', '[]'::jsonb)) AS issue_row(value) WHERE issue_row.value->>'severity' = 'error') THEN
    RAISE EXCEPTION 'Connector import refused a plan with validation errors.';
  END IF;

  SELECT id, status INTO v_existing_id, v_existing_status
    FROM public.migration_batches
   WHERE idempotency_key = v_payload->>'idempotencyKey'
   FOR UPDATE;
  IF v_existing_id IS NOT NULL THEN
    IF v_existing_status IN ('verified', 'imported') THEN
      RAISE NOTICE 'Connector import skipped existing verified batch %', v_existing_id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'A previous batch with this idempotency key is not verified.';
  END IF;

  SELECT s.id, s.name, s.active, sp.profile_code
    INTO v_site_id, v_site_name, v_site_active, v_profile_code
    FROM public.sites s
    LEFT JOIN public.site_profiles sp ON sp.site_id = s.id
   WHERE s.code = v_site_code
   FOR SHARE OF s;
  IF v_site_id IS NULL OR NOT v_site_active THEN RAISE EXCEPTION 'Active site mapping was not found.'; END IF;
  IF v_mapping->>'expectedSiteName' IS NOT NULL AND v_site_name <> v_mapping->>'expectedSiteName' THEN RAISE EXCEPTION 'Target site name does not match migration mapping.'; END IF;
  IF v_mapping->>'expectedProfileCode' IS NOT NULL AND v_profile_code <> v_mapping->>'expectedProfileCode' THEN RAISE EXCEPTION 'Target profile does not match migration mapping.'; END IF;

  FOR v_log IN SELECT value FROM jsonb_array_elements(COALESCE(v_source->'logs', '[]'::jsonb)) AS x(value) LOOP
    v_month := v_log->>'month';
    IF EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.site_id = v_site_id AND mp.period_month = (v_month || '-01')::date) THEN
      RAISE EXCEPTION 'Duplicate target period %.', v_month;
    END IF;
  END LOOP;
  IF jsonb_typeof(v_source->'rackCapacitySnapshot') = 'object' AND EXISTS (
    SELECT 1 FROM public.rack_capacity_snapshots rs
     WHERE rs.site_id = v_site_id
       AND rs.snapshot_month = ((v_source->'rackCapacitySnapshot'->>'month') || '-01')::date
  ) THEN RAISE EXCEPTION 'Duplicate target rack capacity snapshot.'; END IF;
  FOR v_rack_unit IN SELECT value FROM jsonb_array_elements(COALESCE(v_source->'rackUnitCapacityRows', '[]'::jsonb)) AS x(value) LOOP
    IF EXISTS (
      SELECT 1 FROM public.rack_unit_capacity_snapshots ru
       WHERE ru.site_id = v_site_id
         AND ru.period_month = ((v_rack_unit->>'month') || '-01')::date
    ) THEN RAISE EXCEPTION 'Duplicate target rack-unit snapshot.'; END IF;
  END LOOP;

  INSERT INTO public.migration_batches(source_type, source_identity, source_hash, status, row_count, idempotency_key, metadata)
  VALUES (
    v_source->>'sourceType',
    v_site_code || ':' || (v_source->>'sourceFileName'),
    v_source_hash,
    'validated',
    (v_payload->>'rowCount')::integer,
    v_payload->>'idempotencyKey',
    jsonb_build_object('target_environment', 'development', 'source_path', v_source->>'sourcePath', 'connector_import', true, 'formula_version', 'desktop-v2.3.1')
  ) RETURNING id INTO v_batch_id;

  FOR v_log IN SELECT value FROM jsonb_array_elements(COALESCE(v_source->'logs', '[]'::jsonb)) AS x(value) ORDER BY value->>'month' LOOP
    v_month := v_log->>'month';
    INSERT INTO public.monthly_periods(site_id, period_month) VALUES (v_site_id, (v_month || '-01')::date) RETURNING id INTO v_period_id;
    v_period_ids := array_append(v_period_ids, v_period_id);

    FOR v_ups IN SELECT value FROM jsonb_array_elements(COALESCE(v_log->'ups', '[]'::jsonb)) AS x(value) LOOP
      INSERT INTO public.devices(site_id, code, name, kind)
      VALUES (v_site_id, v_ups->>'upsId', v_ups->>'upsId', 'ups')
      ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, updated_at = now()
      RETURNING id INTO v_device_id;
      INSERT INTO public.ups_readings(period_id, device_id, site_id, phase_code, voltage, current, load_kw, load_kva, raw_inputs)
      VALUES (v_period_id, v_device_id, v_site_id, '', NULLIF(v_ups->>'voltage', '')::numeric, NULLIF(v_ups->>'current', '')::numeric, NULLIF(v_ups->>'loadKw', '')::numeric, NULLIF(v_ups->>'loadKva', '')::numeric, v_ups);
      v_ups_count := v_ups_count + 1;
      FOR v_key, v_phase IN SELECT key, value FROM jsonb_each(COALESCE(v_ups->'phases', '{}'::jsonb)) LOOP
        INSERT INTO public.ups_readings(period_id, device_id, site_id, phase_code, voltage, current, load_kw, load_kva, raw_inputs)
        VALUES (v_period_id, v_device_id, v_site_id, v_key, NULLIF(v_phase->>'voltage', '')::numeric, NULLIF(v_phase->>'current', '')::numeric, NULLIF(v_phase->>'loadKw', '')::numeric, NULLIF(v_phase->>'loadKva', '')::numeric, v_phase);
        v_ups_count := v_ups_count + 1;
      END LOOP;
    END LOOP;

    v_air_values := (COALESCE(v_log->'air', '{}'::jsonb) - 'meters') || COALESCE(v_log->'air'->'meters', '{}'::jsonb);
    FOR v_key, v_air_value IN SELECT key, value FROM jsonb_each(v_air_values) LOOP
      INSERT INTO public.air_meters(site_id, code, name) VALUES (v_site_id, v_key, v_key)
      ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_meter_id;
      v_numeric := CASE WHEN jsonb_typeof(v_air_value) = 'null' THEN NULL ELSE (v_air_value #>> '{}')::numeric END;
      INSERT INTO public.air_meter_readings(period_id, meter_id, site_id, reading, raw_inputs)
      VALUES (v_period_id, v_meter_id, v_site_id, v_numeric, jsonb_build_object('code', v_key, 'reading', v_air_value));
      v_air_count := v_air_count + 1;
    END LOOP;

    FOR v_dc IN SELECT value FROM jsonb_array_elements(COALESCE(v_log->'dc', '[]'::jsonb)) AS x(value) LOOP
      INSERT INTO public.dc_panels(site_id, code, name) VALUES (v_site_id, v_dc->>'panelId', v_dc->>'panelId')
      ON CONFLICT (site_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_panel_id;
      INSERT INTO public.dc_readings(period_id, panel_id, site_id, voltage, current, raw_inputs)
      VALUES (v_period_id, v_panel_id, v_site_id, NULLIF(v_dc->>'voltage', '')::numeric, NULLIF(v_dc->>'current', '')::numeric, v_dc);
      v_dc_count := v_dc_count + 1;
    END LOOP;

    v_sri := COALESCE(v_log->'srinakarinInputs', '{}'::jsonb);
    FOR v_key, v_phase IN SELECT key, value FROM jsonb_each(COALESCE(v_sri->'upsPhase', '{}'::jsonb)) LOOP
      INSERT INTO public.electrical_phase_readings(period_id, site_id, source_kind, source_key, phase_code, voltage, current, load_kw, load_kva, raw_inputs)
      VALUES (v_period_id, v_site_id, 'ups_phase', split_part(v_key, ' - ', 1), split_part(v_key, ' - ', 2), NULLIF(v_phase->>'voltage', '')::numeric, NULLIF(v_phase->>'current', '')::numeric, NULLIF(v_phase->>'loadKw', '')::numeric, NULLIF(v_phase->>'loadKva', '')::numeric, v_phase);
      v_electrical_count := v_electrical_count + 1;
    END LOOP;
    FOR v_key, v_phase IN SELECT key, value FROM jsonb_each(COALESCE(v_sri->'acPhase', '{}'::jsonb)) LOOP
      INSERT INTO public.electrical_phase_readings(period_id, site_id, source_kind, source_key, phase_code, voltage, current, raw_inputs)
      VALUES (v_period_id, v_site_id, 'ac_phase', split_part(v_key, ' - ', 1), split_part(v_key, ' - ', 2), NULLIF(v_phase->>'voltage', '')::numeric, NULLIF(v_phase->>'current', '')::numeric, v_phase);
      v_electrical_count := v_electrical_count + 1;
    END LOOP;
    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(COALESCE(v_sri->'ppc43Current', '{}'::jsonb)) LOOP
      INSERT INTO public.electrical_phase_readings(period_id, site_id, source_kind, source_key, current, raw_inputs)
      VALUES (v_period_id, v_site_id, 'ppc43_current', v_key, CASE WHEN jsonb_typeof(v_value) = 'null' THEN NULL ELSE (v_value #>> '{}')::numeric END, jsonb_build_object('sourceKey', v_key, 'current', v_value));
      v_electrical_count := v_electrical_count + 1;
    END LOOP;
    FOR v_key, v_phase IN SELECT key, value FROM jsonb_each(COALESCE(v_sri->'ppc43Panel', '{}'::jsonb)) LOOP
      INSERT INTO public.electrical_phase_readings(period_id, site_id, source_kind, source_key, load_kw, load_kva, raw_inputs)
      VALUES (v_period_id, v_site_id, 'ppc43_panel', v_key, NULLIF(v_phase->>'loadKw', '')::numeric, NULLIF(v_phase->>'loadKva', '')::numeric, v_phase);
      v_electrical_count := v_electrical_count + 1;
    END LOOP;

    INSERT INTO public.energy_cost_inputs(period_id, site_id, building_energy_kwh, building_cost_thb, raw_inputs)
    VALUES (v_period_id, v_site_id, NULLIF(v_log->'energyCost'->>'buildingEnergyKwh', '')::numeric, NULLIF(v_log->'energyCost'->>'buildingElectricityCostThb', '')::numeric, v_log->'energyCost');
    v_energy_count := v_energy_count + 1;
    IF jsonb_typeof(v_log->'energyCalculation') = 'object' THEN
      INSERT INTO public.electrical_profiles(site_id, profile_version, ups_groups, dc_ids, air_fields)
      VALUES (v_site_id, 'desktop-v2.3.1', v_log->'energyCalculation'->'upsGroups', v_log->'energyCalculation'->'dcIds', v_log->'energyCalculation'->'airFields')
      ON CONFLICT (site_id) DO UPDATE SET ups_groups = EXCLUDED.ups_groups, dc_ids = EXCLUDED.dc_ids, air_fields = EXCLUDED.air_fields, updated_at = now();
    END IF;

    SELECT string_agg(split_part(location_text, '!', 1), ', ' ORDER BY ord), string_agg(location_text, ', ' ORDER BY ord)
      INTO v_source_sheet, v_source_location
      FROM jsonb_array_elements_text(COALESCE((v_source->'sourceLocationsByMonth')->v_month, '[]'::jsonb)) WITH ORDINALITY AS locations(location_text, ord);
    INSERT INTO public.provenance_records(entity_type, entity_id, source_type, source_file_hash, source_file_name, source_sheet, source_location, migration_batch_id)
    VALUES ('monthly_period', v_period_id, v_source->>'sourceType', v_source_hash, v_source->>'sourceFileName', v_source_sheet, v_source_location, v_batch_id);
    INSERT INTO public.audit_events(actor_type, actor_user_id, action, entity_type, entity_id, previous_value, new_value, correlation_id)
    VALUES ('system', NULL, 'upsert', 'monthly_period', v_period_id::text,
      jsonb_build_object('dataset', 'monthly_log', 'site_id', v_site_id, 'period_month', v_month, 'record', 'raw_inputs', 'row_version', 1),
      jsonb_build_object('dataset', 'monthly_log', 'site_id', v_site_id, 'period_month', v_month, 'record', 'raw_inputs', 'row_version', 1, 'provenance', v_source->>'sourceType'),
      'migration:' || v_batch_id::text || ':' || v_month);
    FOR v_value IN SELECT value FROM jsonb_array_elements(COALESCE(v_source->'cachedEvidence', '[]'::jsonb)) AS evidence(value) WHERE evidence.value->>'month' = v_month LOOP
      INSERT INTO public.legacy_cached_evidence(period_id, site_id, field_name, numeric_value, text_value, source_sheet, source_location, formula_version)
      VALUES (v_period_id, v_site_id, v_value->>'fieldName', NULLIF(v_value->>'numericValue', '')::numeric, v_value->>'textValue', v_value->>'sourceSheet', v_value->>'sourceLocation', v_value->>'formulaVersion');
    END LOOP;

    SELECT value INTO v_calc FROM jsonb_array_elements(COALESCE(v_payload->'calculations', '[]'::jsonb)) AS calculations(value) WHERE calculations.value->>'month' = v_month;
    IF v_calc IS NULL THEN RAISE EXCEPTION 'Missing domain calculation for %.', v_month; END IF;
    INSERT INTO public.calculation_runs(period_id, calculation_type, formula_version, input_hash)
    VALUES (v_period_id, 'desktop_parity', 'desktop-v2.3.1', v_source_hash) RETURNING id INTO v_run_id;
    FOR v_metric IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('scope_type', 'energy', 'metric_code', 'building_energy_kwh', 'unit', 'kWh', 'numeric_value', v_calc->'energy'->'buildingEnergyKwh'),
      jsonb_build_object('scope_type', 'energy', 'metric_code', 'building_cost_thb', 'unit', 'THB', 'numeric_value', v_calc->'energy'->'buildingElectricityCostThb'),
      jsonb_build_object('scope_type', 'energy', 'metric_code', 'ups_energy_kwh', 'unit', 'kWh', 'numeric_value', v_calc->'energy'->'upsEnergyKwh'),
      jsonb_build_object('scope_type', 'energy', 'metric_code', 'air_energy_kwh', 'unit', 'kWh', 'numeric_value', v_calc->'energy'->'airEnergyKwh'),
      jsonb_build_object('scope_type', 'energy', 'metric_code', 'dc_energy_kwh', 'unit', 'kWh', 'numeric_value', v_calc->'energy'->'dcEnergyKwh'),
      jsonb_build_object('scope_type', 'energy', 'metric_code', 'floor_energy_kwh', 'unit', 'kWh', 'numeric_value', v_calc->'energy'->'floorEnergyKwh'),
      jsonb_build_object('scope_type', 'energy', 'metric_code', 'floor_cost_thb', 'unit', 'THB', 'numeric_value', v_calc->'energy'->'floorElectricityCostThb'),
      jsonb_build_object('scope_type', 'energy', 'metric_code', 'average_rate_thb_per_kwh', 'unit', 'THB/kWh', 'numeric_value', v_calc->'energy'->'averageElectricityRateThbPerKwh'),
      jsonb_build_object('scope_type', 'energy', 'metric_code', 'energy_share_percent', 'unit', '%', 'numeric_value', v_calc->'energy'->'energySharePercent'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'total_energy_kwh', 'unit', 'kWh', 'numeric_value', v_calc->'metrics'->'totalEnergyKwh'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'it_equipment_energy_kwh', 'unit', 'kWh', 'numeric_value', v_calc->'metrics'->'itEquipmentEnergyKwh'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'pue', 'unit', NULL, 'numeric_value', v_calc->'metrics'->'pue'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'carbon_emission_kg', 'unit', 'kg', 'numeric_value', v_calc->'metrics'->'carbonEmissionKg'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'actual_cost_thb', 'unit', 'THB', 'numeric_value', v_calc->'metrics'->'actualCostThb'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'estimated_cost_thb', 'unit', 'THB', 'numeric_value', v_calc->'metrics'->'estimatedCostThb'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'average_rate_thb_per_kwh', 'unit', 'THB/kWh', 'numeric_value', v_calc->'metrics'->'avgElectricityRate'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'data_quality_score', 'unit', 'score', 'numeric_value', v_calc->'metrics'->'dataQualityScore'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'facility_health_score', 'unit', 'score', 'numeric_value', v_calc->'metrics'->'facilityHealthScore'),
      jsonb_build_object('scope_type', 'dashboard', 'metric_code', 'alerts_count', 'unit', 'count', 'numeric_value', v_calc->'metrics'->'alertsCount')
    )) AS metric_values(value) LOOP
      v_numeric := CASE WHEN jsonb_typeof(v_metric->'numeric_value') = 'null' THEN NULL ELSE (v_metric->'numeric_value' #>> '{}')::numeric END;
      INSERT INTO public.calculation_output_values(run_id, scope_type, scope_key, metric_code, unit, numeric_value, source_role)
      VALUES (v_run_id, v_metric->>'scope_type', v_month, v_metric->>'metric_code', v_metric->>'unit', v_numeric, 'calculated');
    END LOOP;
    INSERT INTO public.calculation_output_values(run_id, scope_type, scope_key, metric_code, json_value, source_role)
    VALUES (v_run_id, 'dashboard', v_month, 'alerts', COALESCE(v_calc->'metrics'->'alerts', '[]'::jsonb), 'calculated');
  END LOOP;

  IF jsonb_typeof(v_source->'rackCapacitySnapshot') = 'object' THEN
    INSERT INTO public.rack_capacity_snapshots(site_id, snapshot_month)
    VALUES (v_site_id, ((v_source->'rackCapacitySnapshot'->>'month') || '-01')::date) RETURNING id INTO v_snapshot_id;
    FOR v_rack_record IN SELECT value FROM jsonb_array_elements(COALESCE(v_source->'rackCapacitySnapshot'->'records', '[]'::jsonb)) AS records(value) LOOP
      INSERT INTO public.rack_capacity_records(snapshot_id, source_row_number, rack_zone, rack_id, status, cabinet_size, detail, device_type, remarks, raw_inputs)
      VALUES (v_snapshot_id, NULLIF(v_rack_record->>'rowNumber', '')::integer, v_rack_record->>'rackZone', v_rack_record->>'rackId', v_rack_record->>'status', v_rack_record->>'cabinetSize', v_rack_record->>'detail', v_rack_record->>'deviceType', v_rack_record->>'remarks', v_rack_record);
      v_rack_record_count := v_rack_record_count + 1;
    END LOOP;
  END IF;
  FOR v_rack_unit IN SELECT value FROM jsonb_array_elements(COALESCE(v_source->'rackUnitCapacityRows', '[]'::jsonb)) AS rows(value) LOOP
    INSERT INTO public.rack_unit_capacity_snapshots(site_id, period_month, total_u, used_u)
    VALUES (v_site_id, ((v_rack_unit->>'month') || '-01')::date, (v_rack_unit->>'totalU')::numeric, (v_rack_unit->>'usedU')::numeric);
    v_rack_unit_months := array_append(v_rack_unit_months, ((v_rack_unit->>'month') || '-01')::date);
    v_rack_unit_count := v_rack_unit_count + 1;
  END LOOP;

  SELECT count(*) INTO v_actual_count FROM public.monthly_periods mp WHERE mp.id = ANY(v_period_ids) AND mp.site_id = v_site_id;
  IF v_actual_count <> v_expected_logs THEN RAISE EXCEPTION 'Period count verification failed.'; END IF;
  SELECT count(*) INTO v_actual_count FROM public.ups_readings ur WHERE ur.period_id = ANY(v_period_ids) AND ur.site_id = v_site_id;
  IF v_actual_count <> v_ups_count THEN RAISE EXCEPTION 'UPS reading count verification failed.'; END IF;
  SELECT count(*) INTO v_actual_count FROM public.air_meter_readings ar WHERE ar.period_id = ANY(v_period_ids) AND ar.site_id = v_site_id;
  IF v_actual_count <> v_air_count THEN RAISE EXCEPTION 'Air reading count verification failed.'; END IF;
  SELECT count(*) INTO v_actual_count FROM public.dc_readings dr WHERE dr.period_id = ANY(v_period_ids) AND dr.site_id = v_site_id;
  IF v_actual_count <> v_dc_count THEN RAISE EXCEPTION 'DC reading count verification failed.'; END IF;
  SELECT count(*) INTO v_actual_count FROM public.electrical_phase_readings er WHERE er.period_id = ANY(v_period_ids) AND er.site_id = v_site_id;
  IF v_actual_count <> v_electrical_count THEN RAISE EXCEPTION 'Electrical reading count verification failed.'; END IF;
  SELECT count(*) INTO v_actual_count FROM public.energy_cost_inputs ec WHERE ec.period_id = ANY(v_period_ids) AND ec.site_id = v_site_id;
  IF v_actual_count <> v_energy_count THEN RAISE EXCEPTION 'Energy input count verification failed.'; END IF;
  SELECT count(*) INTO v_actual_count FROM public.provenance_records pr WHERE pr.entity_type = 'monthly_period' AND pr.source_file_hash = v_source_hash AND pr.entity_id = ANY(v_period_ids) AND pr.migration_batch_id = v_batch_id;
  IF v_actual_count <> v_expected_logs THEN RAISE EXCEPTION 'Provenance count verification failed.'; END IF;
  SELECT count(*) INTO v_actual_count FROM public.legacy_cached_evidence le WHERE le.period_id = ANY(v_period_ids);
  IF v_actual_count <> v_expected_evidence THEN RAISE EXCEPTION 'Cached evidence count verification failed.'; END IF;
  SELECT count(*) INTO v_actual_count FROM public.calculation_runs cr WHERE cr.period_id = ANY(v_period_ids) AND cr.calculation_type = 'desktop_parity' AND cr.formula_version = 'desktop-v2.3.1' AND cr.input_hash = v_source_hash;
  IF v_actual_count <> v_expected_logs THEN RAISE EXCEPTION 'Calculation run count verification failed.'; END IF;
  SELECT count(*) INTO v_actual_count FROM public.calculation_output_values cov JOIN public.calculation_runs cr ON cr.id = cov.run_id WHERE cr.period_id = ANY(v_period_ids) AND cr.calculation_type = 'desktop_parity' AND cr.formula_version = 'desktop-v2.3.1' AND cr.input_hash = v_source_hash;
  IF v_actual_count <> v_expected_logs * 20 THEN RAISE EXCEPTION 'Calculation output count verification failed.'; END IF;
  IF v_rack_record_count <> v_expected_rack_records THEN RAISE EXCEPTION 'Rack record count verification failed.'; END IF;
  IF v_rack_unit_count <> v_expected_rack_units THEN RAISE EXCEPTION 'Rack-unit count verification failed.'; END IF;

  UPDATE public.migration_batches
     SET status = 'verified', success_count = v_expected_logs, completed_at = now(), metadata = metadata || jsonb_build_object('verified_via', 'supabase_connector_admin_sql')
   WHERE id = v_batch_id;
  RAISE NOTICE 'Connector import verified site=% batch=% months=%', v_site_code, v_batch_id, v_expected_logs;
END
$do$;`;

const renderedSql = sql.replace("__PAYLOAD__", payload);
const chunkIndex = process.env.CONNECTOR_SQL_CHUNK_INDEX === undefined ? null : Number(process.env.CONNECTOR_SQL_CHUNK_INDEX);
const chunkSize = Number(process.env.CONNECTOR_SQL_CHUNK_SIZE ?? "16000");
if (chunkIndex !== null && Number.isSafeInteger(chunkIndex) && chunkIndex >= 0 && Number.isSafeInteger(chunkSize) && chunkSize > 0) {
  process.stdout.write(`@@SQL_CHUNK_${chunkIndex}@@${renderedSql.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize)}`);
} else {
  process.stdout.write("@@SQL@@" + renderedSql);
}
