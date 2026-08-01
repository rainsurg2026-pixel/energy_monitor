/**
 * One-time, idempotent migration off every Excel-embedded Rack Unit Capacity
 * image mechanism this app has ever shipped, onto the filesystem
 * ImageStorageProvider (src/storage/ImageStorageProvider.ts):
 *
 *  1. Pre-v2.2.3: a single image anchored at K9 on the "Rack Capacity" sheet.
 *  2. v2.2.3-v2.2.4: a single image anchored at K9 on the "Rack Unit
 *     Capacity" sheet (the pre-v2.2.5 "single global slot" design).
 *  3. v2.2.5: one row + one embedded image per (Facility, Reporting Month)
 *     on the "Rack Unit Capacity Img History" sheet.
 *
 * (1) and (2) carry no reliable Reporting Month (they were a single global
 * slot, never month-keyed) - rather than inventing a fake month, any image
 * found there is preserved as a dated "legacy orphan" file the facility can
 * manually re-file under the correct month, never silently discarded. (3)
 * has real (facility, month) identity and migrates directly.
 *
 * Every legacy image is saved to disk and its checksum verified BEFORE any
 * workbook content is removed - a mid-way failure can never lose an image
 * that hasn't been safely persisted to disk yet. Idempotent: a workbook with
 * none of the three legacy mechanisms present is a true no-op (the file on
 * disk is never touched, matching this codebase's "a no-op never appears in
 * the backup history" convention).
 */
import JSZip from "jszip";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { checkWorkbookLock, createBackup, WorkbookError } from "./WorkbookWriter";
import { entryText, getAttr, locateSheetXmlPathByName, resolveRelationshipTarget } from "./ExcelZipUtils";
import { RACK_CAPACITY_SHEET_NAME } from "./RackCapacityWriter";
import { RACK_UNIT_CAPACITY_SHEET_NAME } from "./RackUnitCapacityWriter";
import {
  locateRackUnitCapacityImageHistorySheet,
  readRackUnitCapacityImageHistoryRowImage,
  readRackUnitCapacityImageHistoryRowsWithNumbers,
  removeRackUnitCapacityImageHistorySheet
} from "./RackUnitCapacityImageHistoryWriter";
import * as ImageStorageProvider from "../storage/ImageStorageProvider";

const EMU_PER_PX = 9525;

interface K9Image {
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

/** Generic "read the single K9-anchored image on this named sheet, if any"
 *  - shared by both legacy locations (pre-v2.2.3 "Rack Capacity", v2.2.3-
 *  v2.2.4 "Rack Unit Capacity") rather than one copy per sheet name. */
async function readK9Image(zip: JSZip, sheetXmlPath: string): Promise<K9Image | null> {
  const sheetFile = sheetXmlPath.replace(/^xl\/worksheets\//, "");
  const relsXml = await entryText(zip, `xl/worksheets/_rels/${sheetFile}.rels`);
  if (!relsXml) return null;

  let drawingTarget: string | null = null;
  for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/drawing")) {
      drawingTarget = getAttr(m[1], "Target");
      break;
    }
  }
  if (!drawingTarget) return null;

  const drawingPath = resolveRelationshipTarget("xl/worksheets", drawingTarget);
  const drawingXml = await entryText(zip, drawingPath);
  if (!drawingXml) return null;
  const extMatch = drawingXml.match(/<xdr:ext\b[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);

  const drawingFile = drawingPath.replace(/^xl\/drawings\//, "");
  const drawingRelsXml = await entryText(zip, `xl/drawings/_rels/${drawingFile}.rels`);
  if (!drawingRelsXml) return null;

  let mediaTarget: string | null = null;
  for (const m of drawingRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    if (getAttr(m[1], "Type")?.endsWith("/image")) {
      mediaTarget = getAttr(m[1], "Target");
      break;
    }
  }
  if (!mediaTarget) return null;

  const mediaPath = resolveRelationshipTarget("xl/drawings", mediaTarget);
  const mediaFile = zip.file(mediaPath);
  if (!mediaFile) return null;
  const ext = mediaPath.match(/\.(png|jpe?g)$/i)?.[1]?.toLowerCase();
  if (!ext) return null;
  const bytes = await mediaFile.async("nodebuffer");
  const width = extMatch ? Math.round(Number(extMatch[1]) / EMU_PER_PX) : 0;
  const height = extMatch ? Math.round(Number(extMatch[2]) / EMU_PER_PX) : 0;
  return { bytes, mimeType: ext === "png" ? "image/png" : "image/jpeg", width, height };
}

/** Removes the drawing/media this named sheet's K9 image lives in, but
 *  leaves the sheet itself intact (both "Rack Capacity" and "Rack Unit
 *  Capacity" carry real, unrelated data beyond the image). */
async function removeK9Drawing(zip: JSZip, sheetXmlPath: string): Promise<void> {
  const sheetFile = sheetXmlPath.replace(/^xl\/worksheets\//, "");
  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const relsXml = await entryText(zip, relsPath);
  if (!relsXml) return;
  const relMatch = [...relsXml.matchAll(/<Relationship\b([^>]*)\/>/g)].find(m => getAttr(m[1], "Type")?.endsWith("/drawing"));
  if (!relMatch) return;
  const rid = getAttr(relMatch[1], "Id");
  const drawingTarget = getAttr(relMatch[1], "Target");
  if (!rid || !drawingTarget) return;

  const drawingPath = resolveRelationshipTarget("xl/worksheets", drawingTarget);
  const drawingFile = drawingPath.replace(/^xl\/drawings\//, "");
  const drawingRelsPath = `xl/drawings/_rels/${drawingFile}.rels`;
  const drawingRelsXml = await entryText(zip, drawingRelsPath);
  if (drawingRelsXml) {
    for (const m of drawingRelsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
      const mediaTarget = getAttr(m[1], "Target");
      if (mediaTarget) zip.remove(resolveRelationshipTarget("xl/drawings", mediaTarget));
    }
  }
  zip.remove(drawingPath);
  zip.remove(drawingRelsPath);

  zip.file(relsPath, relsXml.replace(relMatch[0], ""));
  const sheetXml = await entryText(zip, sheetXmlPath);
  if (sheetXml) {
    const stripped = sheetXml.replace(new RegExp(`<drawing r:id="${rid}"\\/>`), "");
    if (stripped !== sheetXml) zip.file(sheetXmlPath, stripped);
  }
  const contentTypesXml = await entryText(zip, "[Content_Types].xml");
  if (contentTypesXml) {
    const escaped = drawingPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = contentTypesXml.replace(new RegExp(`<Override PartName="/${escaped}"[^>]*\\/>`), "");
    if (stripped !== contentTypesXml) zip.file("[Content_Types].xml", stripped);
  }
}

/** Saves a legacy K9 image (no reliable Reporting Month) as a dated orphan
 *  file, distinct from the normal RUC-<Mon>-<YY> naming, so it is preserved
 *  rather than silently discarded and is obviously not a real monthly
 *  record. Written directly (not through ImageStorageProvider.saveImage,
 *  whose contract is strictly the (facility, month) identity model). */
async function saveOrphanImage(imagesRootDir: string, facility: string, sourceSheet: string, image: K9Image): Promise<string> {
  const dir = ImageStorageProvider.facilityDir(imagesRootDir, facility);
  await fs.mkdir(dir, { recursive: true });
  const ext = image.mimeType === "image/jpeg" ? "jpg" : "png";
  const checksum = crypto.createHash("sha256").update(image.bytes).digest("hex");
  // Filename is derived from (source sheet, content checksum), never a
  // wall-clock timestamp - a crash-then-retry (e.g. the workbook rewrite
  // fails after this step but before the atomic rename, so the legacy K9
  // image is still present on the next migration attempt) re-derives the
  // SAME filename and overwrites in place, rather than accumulating a new
  // orphan file per retry.
  const sourceSlug = sourceSheet.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const fileName = `RUC-legacy-orphan-${sourceSlug}-${checksum.slice(0, 12)}.${ext}`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, image.bytes);
  const verify = crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
  if (verify !== checksum) throw new Error(`Legacy orphan image checksum mismatch writing ${filePath}.`);
  await fs.writeFile(
    `${filePath}.json`,
    JSON.stringify(
      {
        facility,
        reportingMonth: null,
        fileName,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height,
        sizeBytes: image.bytes.length,
        savedAt: new Date().toISOString(),
        savedBy: "migration",
        checksum,
        note: `Recovered from the legacy "${sourceSheet}" sheet's K9 image slot during the v2.2.6 filesystem-storage migration. This slot was never month-keyed, so its Reporting Month could not be determined - re-save it under the correct month via the Rack Unit Capacity panel if it is still relevant.`
      },
      null,
      2
    )
  );
  return filePath;
}

export interface RackUnitImageMigrationResult {
  migrated: boolean;
  path: string;
  backupPath: string | null;
  historyRowsMigrated: number;
  orphansRecovered: number;
  /** Full filesystem path of every recovered orphan (legacy K9 slot with no
   *  reliable Reporting Month) - the only place these files are surfaced,
   *  since they are deliberately excluded from ImageStorageProvider.listImages(). */
  orphanFilePaths: string[];
  removedHistorySheet: boolean;
  removedLegacyRackCapacityK9: boolean;
  removedLegacyRackUnitCapacityK9: boolean;
}

/**
 * Full controlled migration: lock check -> extract every legacy image and
 * verify it landed on disk -> strip all legacy storage from the workbook ->
 * backup -> atomic write -> re-read for verification. Mirrors this
 * codebase's other save orchestrators' lock/backup/atomic-write shape.
 */
export async function migrateRackUnitCapacityImagesToFilesystem(
  filePath: string,
  facility: string,
  imagesRootDir: string,
  options: { backupDir: string; backupKeep: number }
): Promise<RackUnitImageMigrationResult> {
  let original: Buffer;
  try {
    original = await fs.readFile(filePath);
  } catch {
    throw new WorkbookError("NOT_FOUND", `Workbook not found: ${filePath}`, "read");
  }

  const zip = await JSZip.loadAsync(original);

  const rackCapacitySheetPath = await locateSheetXmlPathByName(zip, RACK_CAPACITY_SHEET_NAME);
  const rackUnitCapacitySheetPath = await locateSheetXmlPathByName(zip, RACK_UNIT_CAPACITY_SHEET_NAME);
  const legacyRackCapacityImage = rackCapacitySheetPath ? await readK9Image(zip, rackCapacitySheetPath) : null;
  const legacyRackUnitCapacityImage = rackUnitCapacitySheetPath ? await readK9Image(zip, rackUnitCapacitySheetPath) : null;
  const historyRows = await readRackUnitCapacityImageHistoryRowsWithNumbers(original);

  if (!legacyRackCapacityImage && !legacyRackUnitCapacityImage && historyRows.length === 0) {
    return {
      migrated: false,
      path: filePath,
      backupPath: null,
      historyRowsMigrated: 0,
      orphansRecovered: 0,
      orphanFilePaths: [],
      removedHistorySheet: false,
      removedLegacyRackCapacityK9: false,
      removedLegacyRackUnitCapacityK9: false
    };
  }

  const lock = await checkWorkbookLock(filePath);
  if (lock.locked) {
    throw new WorkbookError("LOCKED", "The workbook is currently open in Excel (or another program). Close it and retry.", "lock");
  }

  // Step 1: persist every legacy image to disk FIRST, verified, before any
  // workbook content is touched.
  let historyRowsMigrated = 0;
  const historySheetPath = await locateRackUnitCapacityImageHistorySheet(zip);
  if (historySheetPath) {
    for (const { rowNumber, row } of historyRows) {
      const entry = await readRackUnitCapacityImageHistoryRowImage(zip, historySheetPath, rowNumber);
      if (!entry) continue;
      const type: "png" | "jpeg" = entry.mimeType === "image/jpeg" ? "jpeg" : "png";
      const saved = await ImageStorageProvider.saveImage(
        imagesRootDir,
        row.facility || facility,
        row.reportingMonth,
        { bytes: entry.bytes, type, width: entry.width, height: entry.height },
        row.user || "migration"
      );
      const verify = await ImageStorageProvider.loadImage(imagesRootDir, row.facility || facility, row.reportingMonth);
      if (!verify || verify.checksum !== saved.checksum) {
        throw new Error(`Migration checksum verification failed for ${row.facility} ${row.reportingMonth}.`);
      }
      historyRowsMigrated++;
    }
  }

  const orphanFilePaths: string[] = [];
  if (legacyRackCapacityImage) {
    orphanFilePaths.push(await saveOrphanImage(imagesRootDir, facility, RACK_CAPACITY_SHEET_NAME, legacyRackCapacityImage));
  }
  if (legacyRackUnitCapacityImage) {
    orphanFilePaths.push(await saveOrphanImage(imagesRootDir, facility, RACK_UNIT_CAPACITY_SHEET_NAME, legacyRackUnitCapacityImage));
  }

  // Step 2: only now, strip every legacy mechanism from the workbook - every
  // image is already safely verified on disk.
  const removedHistorySheet = await removeRackUnitCapacityImageHistorySheet(zip);
  if (legacyRackCapacityImage && rackCapacitySheetPath) await removeK9Drawing(zip, rackCapacitySheetPath);
  if (legacyRackUnitCapacityImage && rackUnitCapacitySheetPath) await removeK9Drawing(zip, rackUnitCapacitySheetPath);

  const buffer = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })) as Buffer;

  let backupPath: string | null = null;
  try {
    backupPath = await createBackup(filePath, options.backupDir, options.backupKeep);
  } catch (err) {
    throw new WorkbookError("WRITE_FAILED", `Could not create a backup before migrating: ${(err as Error).message}`, "backup");
  }

  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}`);
  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, filePath);
  } catch (err) {
    try {
      await fs.unlink(tempPath);
    } catch {
      /* already gone */
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
      throw new WorkbookError("LOCKED", "The workbook became locked while migrating. Close it in Excel and retry.", "write");
    }
    throw new WorkbookError("WRITE_FAILED", `Could not write the migrated workbook: ${(err as Error).message}`, "write");
  }

  return {
    migrated: true,
    path: filePath,
    backupPath,
    historyRowsMigrated,
    orphansRecovered: orphanFilePaths.length,
    orphanFilePaths,
    removedHistorySheet,
    removedLegacyRackCapacityK9: legacyRackCapacityImage !== null,
    removedLegacyRackUnitCapacityK9: legacyRackUnitCapacityImage !== null
  };
}
