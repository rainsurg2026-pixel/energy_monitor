/**
 * ImageStorageProvider - the single, shared filesystem-backed store for the
 * "Rack Unit Capacity" monthly image, replacing every previous Excel-embedded
 * mechanism (the pre-v2.2.3 "Rack Capacity" K9 slot, the v2.2.3-2.2.4 "Rack
 * Unit Capacity" K9 slot, and the v2.2.5 per-(Facility, Month) "Rack Unit
 * Capacity Img History" sheet - see RackUnitCapacityImageMigration.ts for how
 * those are migrated into this store). Images are never embedded into a
 * workbook again.
 *
 * One image per (facility, reportingMonth), saved as
 * `<imagesRootDir>/<Facility>/RUC-<Mon>-<YY>.<png|jpg>` with a JSON metadata
 * sidecar of the same name plus ".json". Deliberately takes `imagesRootDir`
 * as an explicit parameter rather than resolving it internally (no Electron
 * import here) - the same dependency-injection pattern this codebase already
 * uses for workbook paths/backup dirs, which keeps this module usable from
 * both the Electron main process (via src/electron/paths.ts's
 * getRackUnitImagesRootDir()) and standalone test scripts alike.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { monthLabelShort } from "../utils/monthUtils";

export type StoredImageMimeType = "image/png" | "image/jpeg";

export interface StoredImageMeta {
  facility: string;
  /** Canonical "YYYY-MM" - the month this image documents. */
  reportingMonth: string;
  /** "RUC-Jul-26.png" - the exact on-disk filename. */
  fileName: string;
  mimeType: StoredImageMimeType;
  width: number;
  height: number;
  sizeBytes: number;
  /** ISO 8601 - when this image was saved. */
  savedAt: string;
  /** OS username of whoever ran the save - this app has no separate
   *  login/auth system, so the OS account is the only real identity. */
  savedBy: string;
  /** sha256 hex of the raw image bytes - verified on every save and used to
   *  verify migration extraction (never trust a copy without re-hashing it). */
  checksum: string;
}

export interface StoredImage extends StoredImageMeta {
  bytes: Buffer;
}

export interface ImageBytesInput {
  bytes: Buffer;
  type: "png" | "jpeg";
  width: number;
  height: number;
}

const RUC_PREFIX = "RUC";
const FILE_NAME_PATTERN = /^RUC-[A-Za-z]{3}-\d{2}\.(png|jpg)$/;

function extensionFor(type: "png" | "jpeg"): "png" | "jpg" {
  return type === "jpeg" ? "jpg" : "png";
}
function mimeFor(type: "png" | "jpeg"): StoredImageMimeType {
  return type === "jpeg" ? "image/jpeg" : "image/png";
}
function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** "2026-07" -> "RUC-Jul-26" - the filename convention is fixed English,
 *  regardless of the UI's current display language. */
function baseFileName(reportingMonth: string): string {
  return `${RUC_PREFIX}-${monthLabelShort(reportingMonth, "en")}`;
}

export function facilityDir(imagesRootDir: string, facility: string): string {
  return path.join(imagesRootDir, facility);
}

function metaPath(imagePath: string): string {
  return `${imagePath}.json`;
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Finds this (facility, month)'s current image file, regardless of which
 *  extension it was saved with - identity is (facility, reportingMonth), one
 *  image only, so a re-save in a different format replaces rather than
 *  accumulates. */
async function findExistingFile(dir: string, reportingMonth: string): Promise<string | null> {
  const base = baseFileName(reportingMonth);
  for (const ext of ["png", "jpg"] as const) {
    const candidate = path.join(dir, `${base}.${ext}`);
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Saves (or replaces) the image for exactly one (facility, reportingMonth).
 * Verifies the checksum of what actually landed on disk before returning, so
 * a caller never believes a save succeeded when the bytes on disk diverged
 * (e.g. a partial write survived a crash between write and rename - unlikely
 * given the atomic temp-file rename below, but verified rather than assumed).
 */
export async function saveImage(
  imagesRootDir: string,
  facility: string,
  reportingMonth: string,
  image: ImageBytesInput,
  savedBy: string
): Promise<StoredImageMeta> {
  const dir = facilityDir(imagesRootDir, facility);
  await fs.mkdir(dir, { recursive: true });

  const existing = await findExistingFile(dir, reportingMonth);
  if (existing) {
    await fs.rm(existing, { force: true });
    await fs.rm(metaPath(existing), { force: true });
  }

  const ext = extensionFor(image.type);
  const fileName = `${baseFileName(reportingMonth)}.${ext}`;
  const filePath = path.join(dir, fileName);
  const checksum = sha256(image.bytes);

  const tempPath = path.join(dir, `.${fileName}.tmp-${process.pid}`);
  await fs.writeFile(tempPath, image.bytes);
  await fs.rename(tempPath, filePath);

  const meta: StoredImageMeta = {
    facility,
    reportingMonth,
    fileName,
    mimeType: mimeFor(image.type),
    width: image.width,
    height: image.height,
    sizeBytes: image.bytes.length,
    savedAt: new Date().toISOString(),
    savedBy,
    checksum
  };
  await fs.writeFile(metaPath(filePath), JSON.stringify(meta, null, 2));

  const verifyBytes = await fs.readFile(filePath);
  if (sha256(verifyBytes) !== checksum) {
    throw new Error(`Rack Unit Capacity image checksum mismatch after write for ${facility} ${reportingMonth}.`);
  }
  return meta;
}

/** Reads the image for exactly one (facility, reportingMonth), or null if
 *  none was ever saved - never a fallback to the latest/nearest month. */
export async function loadImage(imagesRootDir: string, facility: string, reportingMonth: string): Promise<StoredImage | null> {
  const dir = facilityDir(imagesRootDir, facility);
  const filePath = await findExistingFile(dir, reportingMonth);
  if (!filePath) return null;
  const bytes = await fs.readFile(filePath);

  const metaRaw = await fs.readFile(metaPath(filePath), "utf8").catch(() => null);
  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw) as StoredImageMeta;
      return { ...meta, bytes };
    } catch {
      /* corrupt sidecar - fall through and reconstruct the minimum below */
    }
  }
  const ext = path.extname(filePath).replace(".", "").toLowerCase();
  const stat = await fs.stat(filePath);
  return {
    facility,
    reportingMonth,
    fileName: path.basename(filePath),
    mimeType: ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png",
    width: 0,
    height: 0,
    sizeBytes: stat.size,
    savedAt: stat.mtime.toISOString(),
    savedBy: "unknown",
    checksum: sha256(bytes),
    bytes
  };
}

export async function deleteImage(imagesRootDir: string, facility: string, reportingMonth: string): Promise<boolean> {
  const dir = facilityDir(imagesRootDir, facility);
  const filePath = await findExistingFile(dir, reportingMonth);
  if (!filePath) return false;
  await fs.rm(filePath, { force: true });
  await fs.rm(metaPath(filePath), { force: true });
  return true;
}

export async function exists(imagesRootDir: string, facility: string, reportingMonth: string): Promise<boolean> {
  const dir = facilityDir(imagesRootDir, facility);
  return (await findExistingFile(dir, reportingMonth)) !== null;
}

/** All recorded images for a facility, sorted by reporting month - metadata
 *  only, matching readRackUnitCapacityImageHistoryFromBuffer's old contract
 *  (never the whole set of image bytes at once). */
export async function listImages(imagesRootDir: string, facility: string): Promise<StoredImageMeta[]> {
  const dir = facilityDir(imagesRootDir, facility);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const results: StoredImageMeta[] = [];
  for (const entry of entries) {
    if (!FILE_NAME_PATTERN.test(entry)) continue;
    const metaRaw = await fs.readFile(path.join(dir, `${entry}.json`), "utf8").catch(() => null);
    if (!metaRaw) continue;
    try {
      results.push(JSON.parse(metaRaw) as StoredImageMeta);
    } catch {
      /* skip corrupt sidecar */
    }
  }
  return results.sort((a, b) => a.reportingMonth.localeCompare(b.reportingMonth));
}
