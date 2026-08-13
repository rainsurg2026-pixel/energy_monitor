import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { validateImageBytes } from "../../src/utils/imageValidation";
import type { MigrationImageSource } from "./types";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
};

const IMAGE_FILE = /^RUC-([A-Za-z]{3})-(\d{2})\.(png|jpe?g)$/i;
const FACILITY_NAMES: Record<string, string> = {
  rangsit: "rangsit",
  srinakarin: "srinakarin"
};

interface Candidate {
  filePath: string;
  facility: string;
  month: string;
}

function normalizedFacility(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function canonicalSiteCode(value: string): string {
  return FACILITY_NAMES[normalizedFacility(value)] ?? value.trim().toLowerCase();
}

function facilityFromPath(filePath: string, rootDir: string): string | null {
  const relative = path.relative(rootDir, filePath);
  const parts = relative.split(path.sep).filter(Boolean);
  const markerIndex = parts.findIndex(part => normalizedFacility(part) === "rackunitimages");
  const facility = markerIndex >= 0 ? parts[markerIndex + 1] : parts.at(-2);
  return facility?.trim() || null;
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function candidateFor(filePath: string, rootDir: string): Candidate | null {
  const match = IMAGE_FILE.exec(path.basename(filePath));
  if (!match) return null;
  const monthNumber = MONTHS[match[1].toLowerCase()];
  if (!monthNumber) return null;
  const facility = facilityFromPath(filePath, rootDir);
  if (!facility) return null;
  const year = Number(`20${match[2]}`);
  return { filePath, facility, month: `${year}-${monthNumber}` };
}

/**
 * Reads the Desktop filesystem image store without modifying it. The source
 * is deliberately explicit: the caller supplies MIGRATION_IMAGES_ROOT rather
 * than allowing a migration to guess from the repository or release tree.
 * Duplicate copies are accepted only when their bytes have the same SHA-256;
 * conflicting bytes for one (site, month) fail closed.
 */
export async function readRackUnitCapacityImageSources(
  imagesRootDir: string,
  siteCode: string
): Promise<MigrationImageSource[]> {
  const root = path.resolve(imagesRootDir);
  const wantedSite = canonicalSiteCode(siteCode);
  const candidates = (await walkFiles(root))
    .map(filePath => candidateFor(filePath, root))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .filter(candidate => canonicalSiteCode(candidate.facility) === wantedSite)
    .sort((left, right) => left.filePath.localeCompare(right.filePath));

  const byMonth = new Map<string, MigrationImageSource>();
  for (const candidate of candidates) {
    const bytes = await readFile(candidate.filePath);
    const validation = validateImageBytes(bytes);
    if (validation.ok === false) throw new Error(`Invalid Desktop Rack Unit Capacity image: ${path.basename(candidate.filePath)} (${validation.reason}).`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const source: MigrationImageSource = {
      siteCode: wantedSite,
      reportingMonth: candidate.month,
      sourcePath: candidate.filePath,
      bytes,
      contentType: validation.image.mimeType,
      byteSize: bytes.length,
      sha256,
      width: validation.image.width,
      height: validation.image.height
    };
    const existing = byMonth.get(candidate.month);
    if (existing && existing.sha256 !== source.sha256) {
      throw new Error(`Conflicting Desktop Rack Unit Capacity images found for ${wantedSite} ${candidate.month}.`);
    }
    if (!existing) byMonth.set(candidate.month, source);
  }
  return [...byMonth.values()].sort((left, right) => left.reportingMonth.localeCompare(right.reportingMonth));
}
