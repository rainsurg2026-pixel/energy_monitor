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

import { promises as fs } from "fs";
import path from "path";
import { ensureDir, getAppRoot, getConfigDir, log } from "./paths";

export interface FacilityProfile {
  id: string;
  name: string;
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
}

export interface FacilityEntry {
  id: string;
  name: string;
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

function defaultProfile(id: string, name: string, accent: string, logo: string): FacilityProfile {
  return {
    id,
    name,
    logo,
    theme: { accent },
    devices: { ups: [...DEFAULT_UPS], dc: [...DEFAULT_DC] },
    air: {
      fields: [...AIR_FIELDS],
      labels: {
        eb41a: "EB41A (GWh)",
        eb41b: "EB41B (GWh)",
        eb42a: "EB42A (GWh)",
        eb42b: "EB42B (GWh)"
      }
    },
    benchmark: { pueTarget: 1.6, voltageMin: 212, voltageMax: 228, currentHighA: 40 },
    validation: { requiredSections: ["ups", "air", "dc", "energy"], requireAllFields: true }
  };
}

interface RawFacilitiesFile {
  defaultFacility?: string;
  facilities?: Array<{ id?: string; name?: string; workbook?: string; profile?: string }>;
}

function facilitiesFilePath(): string {
  return path.join(getConfigDir(), "facilities.json");
}

function resolveAgainstRoot(p: string): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.join(getAppRoot(), p);
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
function normalizeProfile(raw: Partial<FacilityProfile> | null, id: string, name: string): FacilityProfile {
  const base = defaultProfile(id, name, "indigo", "⚡");
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    id,
    name: typeof raw.name === "string" && raw.name ? raw.name : name,
    logo: typeof raw.logo === "string" && raw.logo ? raw.logo : base.logo,
    theme: { ...base.theme, ...(raw.theme ?? {}) },
    devices: {
      ups: Array.isArray(raw.devices?.ups) && raw.devices.ups.length > 0 ? raw.devices.ups.map(String) : base.devices.ups,
      dc: Array.isArray(raw.devices?.dc) && raw.devices.dc.length > 0 ? raw.devices.dc.map(String) : base.devices.dc
    },
    air: {
      fields: base.air.fields, // model fields are fixed; labels are configurable
      labels: { ...base.air.labels, ...(raw.air?.labels ?? {}) }
    },
    benchmark: { ...base.benchmark, ...(raw.benchmark ?? {}) },
    validation: { ...base.validation, ...(raw.validation ?? {}) }
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
        { id: "rangsit", name: "Rangsit", workbook: "DC_Rangsit.xlsm", profile: "config/rangsit/profile.json" },
        { id: "srinakarin", name: "Srinakarin", workbook: "DC_Srinakarin.xlsm", profile: "config/srinakarin/profile.json" }
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
    const profileRel = String(entry.profile ?? `config/${id}/profile.json`);
    const profilePath = resolveAgainstRoot(profileRel);

    let profileRaw = await readJson<Partial<FacilityProfile>>(profilePath);
    if (!profileRaw) {
      profileRaw = defaultProfile(id, name, id === "srinakarin" ? "teal" : "indigo", id === "srinakarin" ? "🏢" : "⚡");
      await writeJson(profilePath, profileRaw);
      log.info(`facility profile created: ${profilePath}`);
    }

    facilities.push({
      id,
      name,
      workbook: resolveAgainstRoot(String(entry.workbook)),
      profilePath,
      profile: normalizeProfile(profileRaw, id, name)
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
