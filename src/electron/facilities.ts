/**
 * Facility registry - multi-facility support (RC1).
 *
 * config/facilities.json lists the facilities; each facility has its own,
 * completely independent workbook and a profile file
 * (config/<id>/profile.json) that defines its devices, labels, benchmarks,
 * validation rules, theme and logo. Nothing facility-specific is hardcoded:
 * the app renders whatever the active profile declares.
 *
 * Workbook and profile paths may be relative - they resolve against the
 * portable app root (beside the executable).
 */

import { promises as fs, existsSync } from "fs";
import path from "path";
import { ensureDir, getAppRoot, getConfigDir, log } from "./paths";

/** One row of the dashboard's grouped UPS load table. */
export interface DashboardUpsGroup {
  name: string;
  ids: string[];
  /** Rated capacity in kVA, or null where no authoritative figure exists. */
  capacity: number | null;
}

/** One row of the dashboard's detailed hardware mapping table (UMDB/STS/OUDB
 *  for Rangsit; "—" placeholders for facilities with no such busbar scheme). */
export interface DashboardUpsMappingRow {
  no: number;
  umdb: string;
  upsId: string;
  /** Alternate lookup id when upsId includes non-matching decoration, e.g. "UPS 15A (PPC44A)" -> "UPS 15A". */
  keyId?: string;
  sts: string;
  oudb: string;
  capacity: number | null;
}

/** Dashboard presentation topology - the ONLY place UPS grouping/mapping is
 *  defined. Dashboard components (DashboardSummary, UniversalFilterBar) read
 *  this and never branch on facility id/name; a new facility needs only a
 *  profile.json entry here, no component change. */
export interface FacilityDashboardConfig {
  upsGroups: DashboardUpsGroup[];
  upsMapping: DashboardUpsMappingRow[];
}

export interface FacilityProfile {
  id: string;
  name: string;
  /** Long-form name shown in reports and tooltips ("Rangsit Data Center"). */
  displayName: string;
  /** Title line used on exported reports. */
  reportTitle: string;
  logo: string;
  theme: { accent: string };
  devices: {
    ups: string[];
    dc: string[];
  };
  air: {
    fields: string[]; // fixed model fields (eb41a..eb42b); labels are per-facility
    labels: Record<string, string>;
  };
  benchmark: {
    pueTarget: number;
    voltageMin: number;
    voltageMax: number;
    currentHighA: number;
  };
  validation: {
    requiredSections: Array<"ups" | "air" | "dc" | "energy">;
    requireAllFields: boolean;
  };
  dashboard: FacilityDashboardConfig;
}

export interface FacilityEntry {
  id: string;
  name: string;
  displayName: string;
  workbook: string; // resolved absolute path
  profilePath: string;
  profile: FacilityProfile;
}

export interface FacilitiesConfig {
  defaultFacility: string;
  facilities: FacilityEntry[];
}

const DEFAULT_UPS = ["UPS 11A", "UPS 11B", "UPS 13A", "UPS 13B", "UPS 14C", "UPS 15A (PPC44A)", "UPS 15B (PPC44B)"];
const DEFAULT_DC = ["DC PDB41A", "DC PDB41B", "DC PDB42A", "DC PDB42B"];
const AIR_FIELDS = ["eb41a", "eb41b", "eb42a", "eb42b"];

// Rangsit's dashboard topology (UPS grouping + UMDB/STS/OUDB hardware
// mapping). `config/` is gitignored (portable-app runtime state), so this is
// the actual, only source of truth shipped with the application - a fresh
// install with no config/ directory must reproduce this exactly, not an
// empty table. Values must stay byte-identical to what DashboardSummary.tsx
// rendered before the config-driven refactor (see docs/desktop/
// KNOWN_TECHNICAL_DEBT.md and scripts/test-dashboard-config-driven.ts, which
// asserts this).
const RANGSIT_DASHBOARD: FacilityDashboardConfig = {
  upsGroups: [
    { name: "UPS 11", ids: ["UPS 11A", "UPS 11B"], capacity: 400 },
    { name: "UPS 13", ids: ["UPS 13A", "UPS 13B"], capacity: 400 },
    { name: "UPS 14", ids: ["UPS 14C"], capacity: 120 },
    { name: "UPS 15 (PPC44A, PPC44B)", ids: ["UPS 15A (PPC44A)", "UPS 15B (PPC44B)"], capacity: 400 }
  ],
  upsMapping: [
    { no: 1, umdb: "UMDB11A (EMDB_12A2)", upsId: "UPS 11A", sts: "STS11A", oudb: "OUDB41A", capacity: 400 },
    { no: 2, umdb: "UMDB11B (EMDB_12B2)", upsId: "UPS 11B", sts: "STS11B", oudb: "OUDB41B", capacity: 400 },
    { no: 3, umdb: "UMDB13A (EMDB_12A1)", upsId: "UPS 13A", sts: "STS13A", oudb: "OUDB42A", capacity: 400 },
    { no: 4, umdb: "UMDB13B (EMDB_12B1)", upsId: "UPS 13B", sts: "STS13B", oudb: "OUDB42B", capacity: 400 },
    { no: 5, umdb: "MTS.UPS14C (EMDB_12A-B1)", upsId: "UPS 14C", sts: "—", oudb: "OUDB43", capacity: 120 },
    { no: 6, umdb: "UMDB15A (EMDB_12A2)", upsId: "UPS 15A (PPC44A)", keyId: "UPS 15A", sts: "STS15A", oudb: "OUDB31A", capacity: 400 },
    { no: 7, umdb: "UMDB15B (EMDB_12B2)", upsId: "UPS 15B (PPC44B)", keyId: "UPS 15B", sts: "STS15B", oudb: "OUDB31B", capacity: 400 }
  ]
};

// Srinakarin has no UMDB/STS/OUDB busbar scheme - "—" placeholders, not
// fabricated values. IDs match the same set SRINAKARIN_AGGREGATE_IDS
// (src/utils/srinakarinPower.ts) uses for phase-reading aggregation; kept as
// a literal copy here (not an import) because that module is renderer-facing
// application code and this is main-process config generation - see
// docs/desktop/KNOWN_TECHNICAL_DEBT.md #1 for the tracked follow-up to
// generate this from a single source at build time.
// Capacity: 400 kVA for every group, verified directly against
// Dashboard-FAC's own "UPS and PPC Load Status" group-summary table
// (DC_Srinakarin.xlsm) - previously left null as a placeholder before that
// sheet's real values were read (see src/reports/upsMappingReader.ts).
const SRINAKARIN_DASHBOARD: FacilityDashboardConfig = {
  upsGroups: [
    { name: "UPS 41", ids: ["UPS 41A", "UPS 41B"], capacity: 400 },
    { name: "PPC 41", ids: ["PPC 41A", "PPC 41B"], capacity: 400 },
    { name: "PPC 42", ids: ["PPC 42A", "PPC 42B"], capacity: 400 },
    { name: "PPC 43", ids: ["PPC 43A", "PPC 43B"], capacity: 400 },
    { name: "PPC 44", ids: ["PPC 44A", "PPC 44B"], capacity: 400 }
  ],
  upsMapping: [
    { no: 1, umdb: "—", upsId: "UPS 41A", sts: "—", oudb: "—", capacity: null },
    { no: 2, umdb: "—", upsId: "UPS 41B", sts: "—", oudb: "—", capacity: null },
    { no: 3, umdb: "—", upsId: "PPC 41A", sts: "—", oudb: "—", capacity: null },
    { no: 4, umdb: "—", upsId: "PPC 41B", sts: "—", oudb: "—", capacity: null },
    { no: 5, umdb: "—", upsId: "PPC 42A", sts: "—", oudb: "—", capacity: null },
    { no: 6, umdb: "—", upsId: "PPC 42B", sts: "—", oudb: "—", capacity: null },
    { no: 7, umdb: "—", upsId: "PPC 43A", sts: "—", oudb: "—", capacity: null },
    { no: 8, umdb: "—", upsId: "PPC 43B", sts: "—", oudb: "—", capacity: null },
    { no: 9, umdb: "—", upsId: "PPC 44A", sts: "—", oudb: "—", capacity: null },
    { no: 10, umdb: "—", upsId: "PPC 44B", sts: "—", oudb: "—", capacity: null }
  ]
};

const SRINAKARIN_UPS = ["UPS41A", "UPS41B", "PPC41A", "PPC41B", "PPC42A", "PPC42B", "PPC43A", "PPC43B", "PPC44A", "PPC44B"];
const SRINAKARIN_DC = ["DC PDB41A", "DC PDB41B"];
const SRINAKARIN_AIR_FIELDS = ["eb41a", "eb41b", "eb43a", "eb43b", "eb44a", "eb44b"];

function defaultProfile(id: string, name: string, accent: string, logo: string): FacilityProfile {
  const displayName = `${name} Data Center`;
  const isSrinakarin = id === "srinakarin";
  return {
    id,
    name,
    displayName,
    reportTitle: `${displayName} — Monthly Power & Energy Report`,
    logo,
    theme: { accent },
    devices: isSrinakarin
      ? { ups: [...SRINAKARIN_UPS], dc: [...SRINAKARIN_DC] }
      : { ups: [...DEFAULT_UPS], dc: [...DEFAULT_DC] },
    air: isSrinakarin
      ? {
          fields: [...SRINAKARIN_AIR_FIELDS],
          labels: {
            eb41a: "EB41A (GWh)",
            eb41b: "EB41B (GWh)",
            eb43a: "EB43A (GWh)",
            eb43b: "EB43B (GWh)",
            eb44a: "EB44A (GWh)",
            eb44b: "EB44B (GWh)"
          }
        }
      : {
          fields: [...AIR_FIELDS],
          labels: {
            eb41a: "EB41A (GWh)",
            eb41b: "EB41B (GWh)",
            eb42a: "EB42A (GWh)",
            eb42b: "EB42B (GWh)"
          }
        },
    benchmark: { pueTarget: 1.6, voltageMin: 212, voltageMax: 228, currentHighA: 40 },
    validation: { requiredSections: ["ups", "air", "dc", "energy"], requireAllFields: true },
    // Fresh install, no config/ directory: the two supported facilities get
    // their complete, real dashboard topology built in - not an empty
    // table. Any OTHER (future, not-yet-supported) facility id still gets
    // the safe empty default until someone configures it.
    dashboard: isSrinakarin ? SRINAKARIN_DASHBOARD : id === "rangsit" ? RANGSIT_DASHBOARD : { upsGroups: [], upsMapping: [] }
  };
}

function normalizeDashboardConfig(raw: Partial<FacilityDashboardConfig> | undefined, base: FacilityDashboardConfig): FacilityDashboardConfig {
  const upsGroups = Array.isArray(raw?.upsGroups)
    ? raw.upsGroups
        .filter((g): g is DashboardUpsGroup => typeof g === "object" && g !== null && typeof g.name === "string" && Array.isArray(g.ids))
        .map(g => ({ name: g.name, ids: g.ids.map(String), capacity: typeof g.capacity === "number" ? g.capacity : null }))
    : base.upsGroups;
  const upsMapping = Array.isArray(raw?.upsMapping)
    ? raw.upsMapping
        .filter((m): m is DashboardUpsMappingRow => typeof m === "object" && m !== null && typeof m.upsId === "string")
        .map((m, idx) => ({
          no: typeof m.no === "number" ? m.no : idx + 1,
          umdb: typeof m.umdb === "string" ? m.umdb : "—",
          upsId: m.upsId,
          keyId: typeof m.keyId === "string" ? m.keyId : undefined,
          sts: typeof m.sts === "string" ? m.sts : "—",
          oudb: typeof m.oudb === "string" ? m.oudb : "—",
          capacity: typeof m.capacity === "number" ? m.capacity : null
        }))
    : base.upsMapping;
  return { upsGroups, upsMapping };
}

interface RawFacilitiesFile {
  defaultFacility?: string;
  facilities?: Array<{ id?: string; name?: string; displayName?: string; workbook?: string; profile?: string }>;
}

function facilitiesFilePath(): string {
  return path.join(getConfigDir(), "facilities.json");
}

function resolveAgainstRoot(p: string): string {
  if (path.isAbsolute(p)) return path.normalize(p);
  const root = getAppRoot();
  const direct = path.join(root, p);
  if (existsSync(direct)) return path.normalize(direct);
  // Development config may retain a `release/` prefix while the portable
  // package places workbooks beside the executable. Resolve the basename as
  // a safe deployment fallback without changing the configured source path.
  const besideExecutable = path.join(root, path.basename(p));
  if (existsSync(besideExecutable)) return path.normalize(besideExecutable);
  return path.normalize(direct);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/** Fill any missing profile fields with defaults (backward/forward compat). */
function normalizeProfile(
  raw: Partial<FacilityProfile> | null,
  id: string,
  name: string,
  displayName: string
): FacilityProfile {
  const base = defaultProfile(id, name, "indigo", "⚡");
  base.displayName = displayName;
  base.reportTitle = `${displayName} — Monthly Power & Energy Report`;
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    id,
    name: typeof raw.name === "string" && raw.name ? raw.name : name,
    displayName: typeof raw.displayName === "string" && raw.displayName ? raw.displayName : base.displayName,
    reportTitle: typeof raw.reportTitle === "string" && raw.reportTitle ? raw.reportTitle : base.reportTitle,
    logo: typeof raw.logo === "string" && raw.logo ? raw.logo : base.logo,
    theme: { ...base.theme, ...(raw.theme ?? {}) },
    devices: {
      ups: Array.isArray(raw.devices?.ups) && raw.devices.ups.length > 0 ? raw.devices.ups.map(String) : base.devices.ups,
      dc: Array.isArray(raw.devices?.dc) && raw.devices.dc.length > 0 ? raw.devices.dc.map(String) : base.devices.dc
    },
    air: {
      // Keep the legacy four-field default, but allow a facility adapter to
      // declare additional workbook meters (for example Srinakarin EB43/44).
      fields: Array.isArray(raw.air?.fields) && raw.air.fields.length > 0
        ? raw.air.fields.map(String)
        : base.air.fields,
      labels: { ...base.air.labels, ...(raw.air?.labels ?? {}) }
    },
    benchmark: { ...base.benchmark, ...(raw.benchmark ?? {}) },
    validation: { ...base.validation, ...(raw.validation ?? {}) },
    dashboard: normalizeDashboardConfig(raw.dashboard, base.dashboard)
  };
}

/**
 * Load facilities.json + every profile, creating spec-default files on first
 * run (Rangsit + Srinakarin) so the portable app works out of the box.
 */
export async function loadFacilities(): Promise<FacilitiesConfig> {
  const file = facilitiesFilePath();
  let raw = await readJson<RawFacilitiesFile>(file);

  if (!raw || !Array.isArray(raw.facilities) || raw.facilities.length === 0) {
    raw = {
      defaultFacility: "rangsit",
      facilities: [
        {
          id: "rangsit",
          name: "Rangsit",
          displayName: "Rangsit Data Center",
          workbook: "DC_Rangsit.xlsm",
          profile: "config/rangsit/profile.json"
        },
        {
          id: "srinakarin",
          name: "Srinakarin",
          displayName: "Srinakarin Data Center",
          workbook: "DC_Srinakarin.xlsm",
          profile: "config/srinakarin/profile.json"
        }
      ]
    };
    await writeJson(file, raw);
    log.info("facilities.json created with default Rangsit/Srinakarin entries");
  }

  const facilities: FacilityEntry[] = [];
  for (const entry of raw.facilities ?? []) {
    if (!entry?.id || !entry?.workbook) continue;
    const id = String(entry.id);
    const name = String(entry.name ?? id);
    const displayName = String(entry.displayName ?? `${name} Data Center`);
    const profileRel = String(entry.profile ?? `config/${id}/profile.json`);
    const profilePath = resolveAgainstRoot(profileRel);

    let profileRaw = await readJson<Partial<FacilityProfile>>(profilePath);
    if (!profileRaw) {
      profileRaw = defaultProfile(id, name, id === "srinakarin" ? "teal" : "indigo", id === "srinakarin" ? "🏢" : "⚡");
      profileRaw.displayName = displayName;
      profileRaw.reportTitle = `${displayName} — Monthly Power & Energy Report`;
      await writeJson(profilePath, profileRaw);
      log.info(`facility profile created: ${profilePath}`);
    }

    facilities.push({
      id,
      name,
      displayName,
      workbook: resolveAgainstRoot(String(entry.workbook)),
      profilePath,
      profile: normalizeProfile(profileRaw, id, name, displayName)
    });
  }

  const defaultFacility =
    typeof raw.defaultFacility === "string" && facilities.some(f => f.id === raw.defaultFacility)
      ? raw.defaultFacility
      : facilities[0]?.id ?? "rangsit";

  return { defaultFacility, facilities };
}

export async function getFacility(id: string): Promise<FacilityEntry | null> {
  const config = await loadFacilities();
  return config.facilities.find(f => f.id === id) ?? null;
}
