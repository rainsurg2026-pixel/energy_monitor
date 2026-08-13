/**
 * Generates one bounded, self-contained SQL transaction for importing one
 * Desktop workbook month through the Supabase SQL MCP bridge.  This is an
 * operator-only fallback for environments where the guarded Postgres CLI
 * cannot obtain the Production connection string.  It never changes schema,
 * settings, users, or storage permissions.
 */
import { readWorkbookSource } from "../server/migration/workbookSource";
import { createMigrationPlan } from "../server/migration/engine";

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)=(.*)$/s);
  if (match) args.set(match[1], match[2]);
  else if (arg.startsWith("--")) args.set(arg.slice(2), "true");
}

const siteCode = args.get("site")?.trim().toLowerCase();
const workbook = args.get("workbook");
const imagesRoot = args.get("images-root");
const month = args.get("month");
const mode = args.get("mode") ?? "month";
if (!siteCode || !workbook || !imagesRoot || !month) throw new Error("site, workbook, images-root, and month are required.");
if (!/^[a-z0-9_-]+$/.test(siteCode) || !/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid site or month.");

const source = await readWorkbookSource(workbook, undefined, { imagesRootDir: imagesRoot, siteCode });
const plan = createMigrationPlan(source, { siteCode });
const log = source.logs.find(entry => entry.month === month);
const calculation = plan.calculations.find(entry => entry.month === month);
if (!log || !calculation) throw new Error(`Source month not found: ${siteCode} ${month}`);

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function dollarJson(value: unknown, label: string): string {
  const json = JSON.stringify(value);
  const tag = `$mcp_${siteCode}_${month.replace("-", "_")}_${label}$`;
  if (json.includes(tag)) throw new Error(`Unexpected SQL dollar-quote delimiter collision: ${label}`);
  return `${tag}${json}${tag}::jsonb`;
}

const sourceHash = sqlString(source.sourceFileHash);
const sourceName = sqlString(source.sourceFileName);
const sourceType = sqlString(source.sourceType);
const batchKey = sqlString(plan.idempotencyKey);
const sourceLocation = (source.sourceLocationsByMonth[month] ?? []).join(", ");
const payload = {
  log,
  calculation,
  evidence: source.cachedEvidence.filter(entry => entry.month === month)
};

function commonDeclarations(): string {
  return `
  payload jsonb := ${dollarJson(payload, "payload")};
  log jsonb := payload->'log';
  calc jsonb := payload->'calculation';
  evidence jsonb;
  item jsonb;
  item_key text;
  item_value jsonb;
  v_site_id bigint;
  v_period_id bigint;
  v_device_id bigint;
  v_meter_id bigint;
  v_panel_id bigint;
  v_run_id bigint;
  v_batch_id bigint;
  source_key text;
  phase_code text;
`;
}

function numericJson(expression: string): string {
  return `NULLIF(${expression}, '')::numeric`;
}

function monthSql(): string {
  return `DO $mcp_do_${siteCode}_${month.replace("-", "_")}$
DECLARE${commonDeclarations()}
BEGIN
  SELECT s.id INTO v_site_id FROM public.sites s WHERE s.code = ${sqlString(siteCode)} AND s.active = true;
  IF v_site_id IS NULL THEN RAISE EXCEPTION 'Active site mapping not found: %', ${siteCode}; END IF;
  SELECT mb.id INTO v_batch_id FROM public.migration_batches mb WHERE mb.idempotency_key = ${batchKey} FOR UPDATE;
  IF v_batch_id IS NULL THEN RAISE EXCEPTION 'Migration batch setup is missing for %', ${siteCode}; END IF;
  IF EXISTS (SELECT 1 FROM public.monthly_periods mp WHERE mp.site_id = v_site_id AND mp.period_month = ${sqlString(`${month}-01`)}::date) THEN
    RAISE EXCEPTION 'Target monthly period already exists: % %', ${siteCode}, ${month};
  END IF;
  INSERT INTO public.monthly_periods(site_id, period_month, last_saved_ups, last_saved_air, last_saved_dc, last_saved_energy_cost)
  VALUES (v_site_id, ${sqlString(`${month}-01`)}::date,
    NULLIF(log->>'lastSavedUps','')::timestamptz,
    NULLIF(log->>'lastSavedAir','')::timestamptz,
    NULLIF(log->>'lastSavedDc','')::timestamptz,
    NULLIF(log->>'lastSavedEnergyCost','')::timestamptz)
  RETURNING id INTO v_period_id;

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(log->'ups','[]'::jsonb)) LOOP
    INSERT INTO public.devices(site_id, code, name, kind)
    VALUES (v_site_id, item->>'upsId', item->>'upsId', 'ups')
    ON CONFLICT (site_id, code) DO UPDATE SET name=EXCLUDED.name, kind=EXCLUDED.kind, updated_at=now()
    RETURNING id INTO v_device_id;
    INSERT INTO public.ups_readings(period_id, device_id, site_id, phase_code, voltage, current, load_kw, load_kva, raw_inputs)
    VALUES (v_period_id, v_device_id, v_site_id, '', ${numericJson("item->>'voltage'")}, ${numericJson("item->>'current'")}, ${numericJson("item->>'loadKw'")}, ${numericJson("item->>'loadKva'")}, item);
    FOR item_key, item_value IN SELECT key, value FROM jsonb_each(COALESCE(item->'phases','{}'::jsonb)) LOOP
      INSERT INTO public.ups_readings(period_id, device_id, site_id, phase_code, voltage, current, load_kw, load_kva, raw_inputs)
      VALUES (v_period_id, v_device_id, v_site_id, item_key, ${numericJson("item_value->>'voltage'")}, ${numericJson("item_value->>'current'")}, ${numericJson("item_value->>'loadKw'")}, ${numericJson("item_value->>'loadKva'")}, item_value);
    END LOOP;
  END LOOP;

  FOR item_key, item_value IN SELECT key, value FROM jsonb_each(COALESCE(log->'air','{}'::jsonb)) LOOP
    IF item_key <> 'meters' AND jsonb_typeof(item_value) IN ('number','null') AND NOT COALESCE((log->'air'->'meters') ? item_key, false) THEN
      INSERT INTO public.air_meters(site_id, code, name) VALUES (v_site_id, item_key, item_key)
      ON CONFLICT (site_id, code) DO UPDATE SET name=EXCLUDED.name RETURNING id INTO v_meter_id;
      INSERT INTO public.air_meter_readings(period_id, meter_id, site_id, reading, raw_inputs)
      VALUES (v_period_id, v_meter_id, v_site_id, ${numericJson("item_value #>> '{}'")}, jsonb_build_object('code',item_key,'reading',item_value));
    ELSIF item_key = 'meters' THEN
      FOR source_key, item_value IN SELECT key, value FROM jsonb_each(COALESCE(item_value,'{}'::jsonb)) LOOP
        INSERT INTO public.air_meters(site_id, code, name) VALUES (v_site_id, source_key, source_key)
        ON CONFLICT (site_id, code) DO UPDATE SET name=EXCLUDED.name RETURNING id INTO v_meter_id;
        INSERT INTO public.air_meter_readings(period_id, meter_id, site_id, reading, raw_inputs)
        VALUES (v_period_id, v_meter_id, v_site_id, ${numericJson("item_value #>> '{}'")}, jsonb_build_object('code',source_key,'reading',item_value));
      END LOOP;
    END IF;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(log->'dc','[]'::jsonb)) LOOP
    INSERT INTO public.dc_panels(site_id, code, name) VALUES (v_site_id, item->>'panelId', item->>'panelId')
    ON CONFLICT (site_id, code) DO UPDATE SET name=EXCLUDED.name RETURNING id INTO v_panel_id;
    INSERT INTO public.dc_readings(period_id, panel_id, site_id, voltage, current, raw_inputs)
    VALUES (v_period_id, v_panel_id, v_site_id, ${numericJson("item->>'voltage'")}, ${numericJson("item->>'current'")}, item);
  END LOOP;

  FOR source_key, item_value IN SELECT key, value FROM jsonb_each(COALESCE(log->'srinakarinInputs'->'upsPhase','{}'::jsonb)) LOOP
    INSERT INTO public.electrical_phase_readings(period_id, site_id, source_kind, source_key, phase_code, voltage, current, load_kw, load_kva, raw_inputs)
    VALUES (v_period_id, v_site_id, 'ups_phase', split_part(source_key,' - ',1), split_part(source_key,' - ',2), ${numericJson("item_value->>'voltage'")}, ${numericJson("item_value->>'current'")}, ${numericJson("item_value->>'loadKw'")}, ${numericJson("item_value->>'loadKva'")}, item_value);
  END LOOP;
  FOR source_key, item_value IN SELECT key, value FROM jsonb_each(COALESCE(log->'srinakarinInputs'->'acPhase','{}'::jsonb)) LOOP
    INSERT INTO public.electrical_phase_readings(period_id, site_id, source_kind, source_key, phase_code, voltage, current, raw_inputs)
    VALUES (v_period_id, v_site_id, 'ac_phase', split_part(source_key,' - ',1), split_part(source_key,' - ',2), ${numericJson("item_value->>'voltage'")}, ${numericJson("item_value->>'current'")}, item_value);
  END LOOP;
  FOR source_key, item_value IN SELECT key, value FROM jsonb_each(COALESCE(log->'srinakarinInputs'->'ppc43Current','{}'::jsonb)) LOOP
    INSERT INTO public.electrical_phase_readings(period_id, site_id, source_kind, source_key, current, raw_inputs)
    VALUES (v_period_id, v_site_id, 'ppc43_current', source_key, ${numericJson("item_value #>> '{}'")}, jsonb_build_object('sourceKey',source_key,'current',item_value));
  END LOOP;
  FOR source_key, item_value IN SELECT key, value FROM jsonb_each(COALESCE(log->'srinakarinInputs'->'ppc43Panel','{}'::jsonb)) LOOP
    INSERT INTO public.electrical_phase_readings(period_id, site_id, source_kind, source_key, load_kw, load_kva, raw_inputs)
    VALUES (v_period_id, v_site_id, 'ppc43_panel', source_key, ${numericJson("item_value->>'loadKw'")}, ${numericJson("item_value->>'loadKva'")}, item_value);
  END LOOP;

  INSERT INTO public.energy_cost_inputs(period_id, site_id, building_energy_kwh, building_cost_thb, raw_inputs)
  VALUES (v_period_id, v_site_id, ${numericJson("log->'energyCost'->>'buildingEnergyKwh'")}, ${numericJson("log->'energyCost'->>'buildingElectricityCostThb'")}, log->'energyCost');
  IF log ? 'energyCalculation' THEN
    INSERT INTO public.electrical_profiles(site_id, profile_version, ups_groups, dc_ids, air_fields)
    VALUES (v_site_id, 'desktop-v2.3.1', log->'energyCalculation'->'upsGroups', log->'energyCalculation'->'dcIds', log->'energyCalculation'->'airFields')
    ON CONFLICT (site_id) DO UPDATE SET ups_groups=EXCLUDED.ups_groups, dc_ids=EXCLUDED.dc_ids, air_fields=EXCLUDED.air_fields, updated_at=now();
  END IF;
  INSERT INTO public.provenance_records(entity_type, entity_id, source_type, source_file_hash, source_file_name, source_sheet, source_location)
  VALUES ('monthly_period', v_period_id, ${sourceType}, ${sourceHash}, ${sourceName}, 'Desktop workbook', ${sqlString(sourceLocation)});
  FOR evidence IN SELECT value FROM jsonb_array_elements(COALESCE(payload->'evidence','[]'::jsonb)) LOOP
    INSERT INTO public.legacy_cached_evidence(period_id, site_id, field_name, numeric_value, text_value, source_sheet, source_location, formula_version)
    VALUES (v_period_id, v_site_id, evidence->>'fieldName', ${numericJson("evidence->>'numericValue'")}, evidence->>'textValue', evidence->>'sourceSheet', evidence->>'sourceLocation', evidence->>'formulaVersion');
  END LOOP;

  INSERT INTO public.calculation_runs(period_id, calculation_type, formula_version, input_hash)
  VALUES (v_period_id, 'desktop_parity', 'desktop-v2.3.1', ${sourceHash}) RETURNING id INTO v_run_id;
  INSERT INTO public.calculation_output_values(run_id, scope_type, scope_key, metric_code, unit, numeric_value, source_role) VALUES
    (v_run_id,'energy',${sqlString(month)},'building_energy_kwh','kWh',${numericJson("calc->'energy'->>'buildingEnergyKwh'")},'calculated'),
    (v_run_id,'energy',${sqlString(month)},'building_cost_thb','THB',${numericJson("calc->'energy'->>'buildingElectricityCostThb'")},'calculated'),
    (v_run_id,'energy',${sqlString(month)},'ups_energy_kwh','kWh',${numericJson("calc->'energy'->>'upsEnergyKwh'")},'calculated'),
    (v_run_id,'energy',${sqlString(month)},'air_energy_kwh','kWh',${numericJson("calc->'energy'->>'airEnergyKwh'")},'calculated'),
    (v_run_id,'energy',${sqlString(month)},'dc_energy_kwh','kWh',${numericJson("calc->'energy'->>'dcEnergyKwh'")},'calculated'),
    (v_run_id,'energy',${sqlString(month)},'floor_energy_kwh','kWh',${numericJson("calc->'energy'->>'floorEnergyKwh'")},'calculated'),
    (v_run_id,'energy',${sqlString(month)},'floor_cost_thb','THB',${numericJson("calc->'energy'->>'floorElectricityCostThb'")},'calculated'),
    (v_run_id,'energy',${sqlString(month)},'average_rate_thb_per_kwh','THB/kWh',${numericJson("calc->'energy'->>'averageElectricityRateThbPerKwh'")},'calculated'),
    (v_run_id,'energy',${sqlString(month)},'energy_share_percent','%',${numericJson("calc->'energy'->>'energySharePercent'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'total_energy_kwh','kWh',${numericJson("calc->'metrics'->>'totalEnergyKwh'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'it_equipment_energy_kwh','kWh',${numericJson("calc->'metrics'->>'itEquipmentEnergyKwh'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'pue',NULL,${numericJson("calc->'metrics'->>'pue'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'carbon_emission_kg','kg',${numericJson("calc->'metrics'->>'carbonEmissionKg'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'actual_cost_thb','THB',${numericJson("calc->'metrics'->>'actualCostThb'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'estimated_cost_thb','THB',${numericJson("calc->'metrics'->>'estimatedCostThb'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'average_rate_thb_per_kwh','THB/kWh',${numericJson("calc->'metrics'->>'avgElectricityRate'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'data_quality_score','score',${numericJson("calc->'metrics'->>'dataQualityScore'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'facility_health_score','score',${numericJson("calc->'metrics'->>'facilityHealthScore'")},'calculated'),
    (v_run_id,'dashboard',${sqlString(month)},'alerts_count','count',${numericJson("calc->'metrics'->>'alertsCount'")},'calculated');
  INSERT INTO public.calculation_output_values(run_id, scope_type, scope_key, metric_code, json_value, source_role)
  VALUES (v_run_id,'dashboard',${sqlString(month)},'alerts',calc->'metrics'->'alerts','calculated');
  UPDATE public.migration_batches SET metadata = metadata || jsonb_build_object('formula_version','desktop-v2.3.1') WHERE id=v_batch_id;
  INSERT INTO public.audit_events(actor_type, action, entity_type, entity_id, previous_value, new_value, correlation_id)
  VALUES ('system','upsert','monthly_period',v_period_id,jsonb_build_object('dataset','monthly_log','previous',NULL),jsonb_build_object('dataset','monthly_log','source_file_hash',${sourceHash}), 'migration:mcp:' || ${sqlString(siteCode)} || ':' || ${sqlString(month)});
END $mcp_do_${siteCode}_${month.replace("-", "_")}$;
`;
}

function setupSql(): string {
  const mapping = source.dashboardMapping;
  return `DO $mcp_setup_${siteCode}$
DECLARE v_site_id bigint; existing_status text; mapping jsonb := ${dollarJson(mapping, "mapping")};
BEGIN
  SELECT s.id INTO v_site_id FROM public.sites s WHERE s.code=${sqlString(siteCode)} AND s.active=true;
  IF v_site_id IS NULL THEN RAISE EXCEPTION 'Active site mapping not found: %', ${siteCode}; END IF;
  UPDATE public.site_profiles sp SET policy=sp.policy || jsonb_build_object('dashboardMapping',mapping), updated_at=now() WHERE sp.site_id=v_site_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Site profile missing: %', ${siteCode}; END IF;
  SELECT status INTO existing_status FROM public.migration_batches WHERE idempotency_key=${batchKey} FOR UPDATE;
  IF existing_status IN ('verified','imported') THEN RAISE EXCEPTION 'Source batch already completed: %', ${siteCode}; END IF;
  INSERT INTO public.migration_batches(source_type,source_identity,source_hash,status,row_count,idempotency_key,metadata)
  VALUES (${sourceType},${sqlString(`${siteCode}:${source.sourceFileName}`)},${sourceHash},'validated',${plan.rowCount},${batchKey},jsonb_build_object('target_environment','production','source_path',${sqlString(source.sourcePath)}))
  ON CONFLICT (idempotency_key) DO NOTHING;
END $mcp_setup_${siteCode}$;
`;
}

function rackSql(): string {
  const rackPayload = { rackCapacitySnapshot: source.rackCapacitySnapshot, rackCapacityRows: source.rackCapacityHistoryRows, rackUnitRows: source.rackUnitCapacityRows, upsHistoryRows: source.upsGroupHistoryRows };
  return `DO $mcp_rack_${siteCode}$
DECLARE payload jsonb := ${dollarJson(rackPayload, "rack")}; v_site_id bigint; item jsonb; rec jsonb; v_snapshot_id bigint; v_existing_id bigint; v_batch_id bigint;
BEGIN
  SELECT s.id INTO v_site_id FROM public.sites s WHERE s.code=${sqlString(siteCode)} AND s.active=true;
  SELECT id INTO v_batch_id FROM public.migration_batches WHERE idempotency_key=${batchKey} FOR UPDATE;
  IF v_site_id IS NULL OR v_batch_id IS NULL THEN RAISE EXCEPTION 'Import setup missing for %', ${siteCode}; END IF;
  IF payload->'rackCapacitySnapshot' <> 'null'::jsonb THEN
    INSERT INTO public.rack_capacity_snapshots(site_id,snapshot_month) VALUES(v_site_id, ((payload->'rackCapacitySnapshot'->>'month') || '-01')::date) RETURNING id INTO v_snapshot_id;
    FOR rec IN SELECT value FROM jsonb_array_elements(payload->'rackCapacitySnapshot'->'records') LOOP
      INSERT INTO public.rack_capacity_records(snapshot_id,source_row_number,rack_zone,rack_id,status,cabinet_size,detail,device_type,remarks,raw_inputs)
      VALUES(v_snapshot_id,(rec->>'rowNumber')::integer,rec->>'rackZone',rec->>'rackId',rec->>'status',rec->>'cabinetSize',rec->>'detail',rec->>'deviceType',rec->>'remarks',rec);
    END LOOP;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(payload->'rackUnitRows','[]'::jsonb)) LOOP
    SELECT ru.id INTO v_existing_id FROM public.rack_unit_capacity_snapshots ru WHERE ru.site_id=v_site_id AND ru.period_month=((item->>'month') || '-01')::date;
    IF v_existing_id IS NULL THEN
      INSERT INTO public.rack_unit_capacity_snapshots(site_id,period_month,total_u,used_u) VALUES(v_site_id,((item->>'month') || '-01')::date,(item->>'totalU')::numeric,(item->>'usedU')::numeric);
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(payload->'rackCapacityRows','[]'::jsonb)) LOOP
    INSERT INTO public.rack_capacity_history(site_id,snapshot_month,facility,rack_zone,total_racks,in_use,available,reserved,pending_dismantle,other,usage_pct,availability_pct,reserved_pct,pending_dismantle_pct,other_pct,generated_at,data_version)
    VALUES(v_site_id,((item->>'snapshotMonth') || '-01')::date,item->>'facility',item->>'rackZone',(item->>'totalRacks')::integer,(item->>'inUse')::integer,(item->>'available')::integer,(item->>'reserved')::integer,(item->>'pendingDismantle')::integer,(item->>'other')::integer,${numericJson("item->>'usagePct'")},${numericJson("item->>'availabilityPct'")},${numericJson("item->>'reservedPct'")},${numericJson("item->>'pendingDismantlePct'")},${numericJson("item->>'otherPct'")},NULLIF(item->>'generatedAt','')::timestamptz,(item->>'dataVersion')::integer);
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(payload->'upsHistoryRows','[]'::jsonb)) LOOP
    INSERT INTO public.ups_group_history(site_id,source_sheet,facility,history_month,group_name,total_load_kw,total_load_kva,capacity,load_percent,available_percent,monthly_energy_kwh,generated_at,data_version)
    VALUES(v_site_id,'2. UPS Group History',item->>'facility',((item->>'month') || '-01')::date,item->>'group',${numericJson("item->>'totalLoadKw'")},${numericJson("item->>'totalLoadKva'")},${numericJson("item->>'capacity'")},${numericJson("item->>'loadPercent'")},${numericJson("item->>'availablePercent'")},${numericJson("item->>'monthlyEnergyKwh'")},NULLIF(item->>'generatedAt','')::timestamptz,NULLIF(item->>'dataVersion','')::integer)
    ON CONFLICT (site_id,history_month,group_name) DO UPDATE SET facility=EXCLUDED.facility,total_load_kw=EXCLUDED.total_load_kw,total_load_kva=EXCLUDED.total_load_kva,capacity=EXCLUDED.capacity,load_percent=EXCLUDED.load_percent,available_percent=EXCLUDED.available_percent,monthly_energy_kwh=EXCLUDED.monthly_energy_kwh,generated_at=EXCLUDED.generated_at,data_version=EXCLUDED.data_version;
  END LOOP;
END $mcp_rack_${siteCode}$;
`;
}

function finalSql(): string {
  return `DO $mcp_final_${siteCode}$
DECLARE v_site_id bigint; v_batch_id bigint; expected_logs integer := ${source.logs.length}; expected_rack_units integer := ${source.rackUnitCapacityRows.length}; expected_rack_history integer := ${source.rackCapacityHistoryRows.length}; expected_ups_history integer := ${new Set(source.upsGroupHistoryRows.map(row => `${row.month}|${row.group}`)).size}; actual_logs integer; actual_rack_units integer; actual_rack_history integer; actual_ups_history integer;
BEGIN
  SELECT s.id INTO v_site_id FROM public.sites s WHERE s.code=${sqlString(siteCode)} AND s.active=true;
  SELECT mb.id INTO v_batch_id FROM public.migration_batches mb WHERE mb.idempotency_key=${batchKey} FOR UPDATE;
  SELECT count(*) INTO actual_logs FROM public.monthly_periods mp WHERE mp.site_id=v_site_id AND mp.period_month BETWEEN ${sqlString(`${source.logs[0].month}-01`)}::date AND ${sqlString(`${source.logs.at(-1)!.month}-01`)}::date;
  SELECT count(*) INTO actual_rack_units FROM public.rack_unit_capacity_snapshots ru WHERE ru.site_id=v_site_id AND ru.period_month=ANY(ARRAY[${source.rackUnitCapacityRows.map(row => sqlString(`${row.month}-01`) + "::date").join(",")}]);
  SELECT count(*) INTO actual_rack_history FROM public.rack_capacity_history rh WHERE rh.site_id=v_site_id AND rh.snapshot_month=ANY(ARRAY[${source.rackCapacityHistoryRows.map(row => sqlString(`${row.snapshotMonth}-01`) + "::date").join(",") || "NULL::date"}]);
  SELECT count(*) INTO actual_ups_history FROM (SELECT DISTINCT uh.history_month,uh.group_name FROM public.ups_group_history uh WHERE uh.site_id=v_site_id) x;
  IF actual_logs <> expected_logs THEN RAISE EXCEPTION 'Monthly log count mismatch for %: expected %, got %', ${sqlString(siteCode)}, expected_logs, actual_logs; END IF;
  IF actual_rack_units < expected_rack_units - 1 THEN RAISE EXCEPTION 'Rack Unit count mismatch for %: expected at least %, got %', ${sqlString(siteCode)}, expected_rack_units - 1, actual_rack_units; END IF;
  IF actual_rack_history <> expected_rack_history THEN RAISE EXCEPTION 'Rack history count mismatch for %: expected %, got %', ${sqlString(siteCode)}, expected_rack_history, actual_rack_history; END IF;
  IF actual_ups_history <> expected_ups_history THEN RAISE EXCEPTION 'UPS history count mismatch for %: expected %, got %', ${sqlString(siteCode)}, expected_ups_history, actual_ups_history; END IF;
  UPDATE public.migration_batches SET status='verified', success_count=expected_logs, completed_at=now() WHERE id=v_batch_id;
END $mcp_final_${siteCode}$;
`;
}

let output: string;
if (mode === "setup") output = setupSql();
else if (mode === "month") output = monthSql();
else if (mode === "rack") output = rackSql();
else if (mode === "final") output = finalSql();
else throw new Error(`Unknown mode: ${mode}`);
const chunkStart = args.has("chunk-start") ? Number(args.get("chunk-start")) : null;
const chunkSize = args.has("chunk-size") ? Number(args.get("chunk-size")) : null;
if (args.has("stats")) {
  process.stdout.write(String(output.length));
  process.exit(0);
}
if (chunkStart !== null || chunkSize !== null) {
  if (!Number.isInteger(chunkStart) || !Number.isInteger(chunkSize) || chunkStart < 0 || chunkSize < 1) throw new Error("chunk-start and chunk-size must be positive integers.");
  output = output.slice(chunkStart, chunkStart + chunkSize);
}
process.stdout.write(output);
