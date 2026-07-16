/**
 * WorkbookVersion - workbook schema versioning, sidecar metadata and the
 * upgrade path for workbooks saved by older app versions.
 *
 * The workbook itself is owned by Excel/VBA; the app never stamps versions
 * inside it. Instead a sidecar file (`<workbook>.appmeta.json`) records the
 * schema version and the per-month "last saved" timestamps that have no
 * column in the RST workbook layout.
 */

import { promises as fs } from "fs";
import { MonthlyLog } from "../types";

export const SCHEMA_VERSION = 1;

export interface WorkbookMeta {
  schemaVersion: number;
  savedAt: string | null;
  months: Record<
    string,
    {
      lastSavedUps: string | null;
      lastSavedAir: string | null;
      lastSavedDc: string | null;
      lastSavedEnergyCost: string | null;
    }
  >;
}

export interface VersionCheckResult {
  compatible: boolean;
  upgraded: boolean;
  message: string | null;
  meta: WorkbookMeta;
}

export function metaPathFor(workbookPath: string): string {
  return `${workbookPath}.appmeta.json`;
}

export function emptyMeta(): WorkbookMeta {
  return { schemaVersion: SCHEMA_VERSION, savedAt: null, months: {} };
}

export async function readWorkbookMeta(workbookPath: string): Promise<WorkbookMeta | null> {
  try {
    const raw = await fs.readFile(metaPathFor(workbookPath), "utf8");
    const parsed = JSON.parse(raw) as WorkbookMeta;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.schemaVersion !== "number") return null;
    return { schemaVersion: parsed.schemaVersion, savedAt: parsed.savedAt ?? null, months: parsed.months ?? {} };
  } catch {
    return null;
  }
}

export async function writeWorkbookMeta(workbookPath: string, logs: MonthlyLog[]): Promise<void> {
  const meta: WorkbookMeta = { schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), months: {} };
  for (const log of logs) {
    meta.months[log.month] = {
      lastSavedUps: log.lastSavedUps,
      lastSavedAir: log.lastSavedAir,
      lastSavedDc: log.lastSavedDc,
      lastSavedEnergyCost: log.lastSavedEnergyCost
    };
  }
  await fs.writeFile(metaPathFor(workbookPath), JSON.stringify(meta, null, 2), "utf8");
}

/**
 * Ordered, idempotent upgrade steps: index N migrates meta from schema
 * version N to N+1. Slots exist from version 1 onward; when SCHEMA_VERSION
 * grows, add one entry per hop here and nothing else has to change.
 */
const META_UPGRADES: Array<(meta: WorkbookMeta) => WorkbookMeta> = [];

/**
 * Check (and if possible upgrade) the sidecar metadata for a workbook.
 * - No sidecar: brand-new or Excel-only workbook -> compatible, empty meta.
 * - Older schema: run upgrade steps in order.
 * - Newer schema: still readable, but warn - a newer app version saved it.
 */
export async function checkWorkbookVersion(workbookPath: string): Promise<VersionCheckResult> {
  const existing = await readWorkbookMeta(workbookPath);
  if (!existing) {
    return { compatible: true, upgraded: false, message: null, meta: emptyMeta() };
  }

  if (existing.schemaVersion > SCHEMA_VERSION) {
    return {
      compatible: true,
      upgraded: false,
      message:
        `This workbook was last saved by a newer version of the app ` +
        `(schema v${existing.schemaVersion}, this app supports v${SCHEMA_VERSION}). ` +
        `It will load, but fields added by the newer version are ignored.`,
      meta: existing
    };
  }

  let meta = existing;
  let upgraded = false;
  for (let v = meta.schemaVersion; v < SCHEMA_VERSION; v++) {
    const step = META_UPGRADES[v - 1];
    meta = step ? step(meta) : meta;
    meta.schemaVersion = v + 1;
    upgraded = true;
  }
  return {
    compatible: true,
    upgraded,
    message: upgraded ? `Workbook metadata upgraded to schema v${SCHEMA_VERSION}.` : null,
    meta
  };
}
