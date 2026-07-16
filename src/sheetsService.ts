import { MonthlyLog, UpsRecord, AirRecord, DcRecord, EnergyCostRecord } from "./types";
import { createEmptyLog, DEFAULT_UPS_IDS, DEFAULT_DC_IDS } from "./utils";

export const DEFAULT_SPREADSHEET_ID = "11ODydrVtRwjL3i2MWX6XEw6GSBo_s2guDZsRrVGqBhA";

const SHEET_NAMES = {
  UPS: "UPS Loads",
  AIR: "Air Conditioning",
  DC: "DC Power Panels",
  ENERGY: "Energy & Cost"
};

// Standard headers
const HEADERS = {
  UPS: ["Month", "UPS ID", "Voltage (V)", "Current (A)", "Load (kW)", "Load (kVA)", "Timestamp"],
  AIR: ["Month", "EB41A (GWh)", "EB41B (GWh)", "EB42A (GWh)", "EB42B (GWh)", "Timestamp"],
  DC: ["Month", "DC Panel ID", "Voltage (V)", "Current (A)", "Timestamp"],
  ENERGY: ["Month", "Building Energy (kWh)", "Electricity Cost (THB)", "Timestamp"]
};

/**
 * Fetch spreadsheet details to get existing sheet titles
 */
export async function getSpreadsheetSheets(accessToken: string, spreadsheetId: string, signal?: AbortSignal): Promise<string[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch spreadsheet info: ${errText}`);
  }

  const data = await res.json();
  const sheets = data.sheets || [];
  return sheets.map((s: any) => s.properties.title);
}

/**
 * Create missing sheets in the spreadsheet
 */
export async function createMissingSheets(accessToken: string, spreadsheetId: string, missingSheets: string[], signal?: AbortSignal): Promise<void> {
  if (missingSheets.length === 0) return;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const requests = missingSheets.map(title => ({
    addSheet: {
      properties: { title }
    }
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ requests }),
    signal
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create sheets: ${errText}`);
  }
}

/**
 * Initialize headers for any sheet that needs it (or has just been created)
 */
export async function initializeSheetHeaders(accessToken: string, spreadsheetId: string, sheetName: string, headers: string[], signal?: AbortSignal): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:Z1?valueInputOption=USER_ENTERED`;

  // First, check if row 1 is empty or has headers
  const checkUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:A1`;
  const checkRes = await fetch(checkUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal
  });

  if (checkRes.ok) {
    const checkData = await checkRes.json();
    if (checkData.values && checkData.values.length > 0) {
      // Row 1 already has content, do not overwrite headers
      return;
    }
  }

  await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      range: `${sheetName}!A1:Z1`,
      majorDimension: "ROWS",
      values: [headers]
    }),
    signal
  });
}

/**
 * Helper to dynamically resolve existing sheets in the spreadsheet based on keywords
 */
export function resolveSheetNames(existingSheets: string[]): { UPS: string; AIR: string; DC: string; ENERGY: string } {
  const resolved = {
    UPS: "UPS Loads",
    AIR: "Air Conditioning",
    DC: "DC Power Panels",
    ENERGY: "Energy & Cost"
  };

  const findMatch = (keywords: string[], defaultName: string) => {
    const found = existingSheets.find(sheet => 
      keywords.some(keyword => sheet.toLowerCase().includes(keyword.toLowerCase()))
    );
    return found || defaultName;
  };

  resolved.UPS = findMatch(["ups"], "UPS Loads");
  resolved.AIR = findMatch(["air", "eb41", "eb42"], "Air Conditioning");
  resolved.DC = findMatch(["dc "], "DC Power Panels");
  resolved.ENERGY = findMatch(["energy", "electricity", "cost"], "Energy & Cost");

  return resolved;
}

/**
 * Helper to normalize any month format (like May-26, 2026-05, etc.) to canonical YYYY-MM
 */
/**
 * Helper to normalize any month format (like May-26, 2026-05, 5/1/2026, etc.) to canonical YYYY-MM
 */
export function normalizeMonthToYyyyMm(val: any): string | null {
  if (val === undefined || val === null || val === "") return null;

  // If it's a number (or string of pure digits), it could be a Google Sheets date serial number
  const numVal = Number(val);
  if (!isNaN(numVal) && numVal > 30000 && numVal < 60000) {
    try {
      const date = new Date((numVal - 25569) * 86400 * 1000);
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        return `${year}-${month}`;
      }
    } catch (e) {
      // fallback
    }
  }

  const str = String(val).trim();

  // 1. Direct match for YYYY-MM
  const yyyyMmMatch = str.match(/^(\d{4})[-/](\d{2})$/);
  if (yyyyMmMatch) {
    let year = parseInt(yyyyMmMatch[1], 10);
    const month = parseInt(yyyyMmMatch[2], 10);
    if (year > 2500) year -= 543;
    if (month >= 1 && month <= 12) {
      return `${year}-${month.toString().padStart(2, "0")}`;
    }
  }

  // 2. Direct match for YYYY-MM-DD
  const yyyyMmDdMatch = str.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (yyyyMmDdMatch) {
    let year = parseInt(yyyyMmDdMatch[1], 10);
    const month = parseInt(yyyyMmDdMatch[2], 10);
    if (year > 2500) year -= 543;
    if (month >= 1 && month <= 12) {
      return `${year}-${month.toString().padStart(2, "0")}`;
    }
  }

  // 3. Try parsing parts by splitting on dash, slash, space, dot, comma
  // Clean up and split
  const separators = /[-/\s.,]+/;
  const parts = str.split(separators).map(p => p.trim()).filter(Boolean);

  const englishShortMonths = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec"
  ];
  const englishFullMonths = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];
  const thaiShortMonths = [
    "มค", "กพ", "มีค", "เมย", "พค", "มิย",
    "กค", "สค", "กย", "ตค", "พย", "ธค"
  ];
  const thaiFullMonths = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ];

  // Helper to find month index (0-11) from a string token
  const findMonthIdx = (token: string): number => {
    const tClean = token.toLowerCase().replace(/\./g, "").trim();
    if (!tClean) return -1;

    let idx = englishShortMonths.findIndex(m => tClean.startsWith(m));
    if (idx !== -1) return idx;

    idx = englishFullMonths.findIndex(m => tClean.startsWith(m));
    if (idx !== -1) return idx;

    idx = thaiShortMonths.findIndex(m => tClean.startsWith(m));
    if (idx !== -1) return idx;

    idx = thaiFullMonths.findIndex(m => tClean.startsWith(m));
    if (idx !== -1) return idx;

    return -1;
  };

  // Look for year and month among parts
  let foundMonthIdx = -1;
  let foundYear: number | null = null;
  let isThaiContext = false;

  for (const part of parts) {
    const idx = findMonthIdx(part);
    if (idx !== -1) {
      foundMonthIdx = idx;
      if (part.match(/[\u0e00-\u0e7f]/)) {
        isThaiContext = true;
      }
      continue;
    }

    const num = parseInt(part, 10);
    if (!isNaN(num)) {
      // If it looks like a year
      if (num >= 100 && num < 10000) {
        foundYear = num;
      } else if (num > 0 && num < 100 && foundYear === null) {
        // Could be a 2-digit year (like "26" or "69")
        // Save it for now, we will process it later
        foundYear = num;
      }
    }
  }

  // If we found both month and year, let's normalize the year and return
  if (foundMonthIdx !== -1 && foundYear !== null) {
    let year = foundYear;
    if (year < 100) {
      // Determine if B.E. or A.D.
      // If Thai context or year > 50 (e.g. 69 B.E. -> 2569 B.E.)
      if (isThaiContext || year > 50) {
        // e.g. year = 69 -> 2569 B.E. -> 2026 A.D.
        // Formula: year = 1957 + year
        year = 1957 + year;
      } else {
        year = 2000 + year;
      }
    } else if (year > 2500) {
      year = year - 543;
    }

    const monthPart = (foundMonthIdx + 1).toString().padStart(2, "0");
    return `${year}-${monthPart}`;
  }

  // 4. Try parsing as numeric parts like DD/MM/YYYY or MM/YYYY
  // Filter only numbers
  const numParts = parts.map(p => parseInt(p, 10)).filter(n => !isNaN(n));
  if (numParts.length >= 2) {
    let yearCandidate = numParts.find(n => n > 100);
    let monthCandidate = -1;

    if (yearCandidate) {
      // We have a 3 or 4 digit year
      // Find the month candidate (a number between 1 and 12, not the year)
      const otherParts = numParts.filter(n => n !== yearCandidate);
      if (otherParts.length > 0) {
        if (numParts.length === 3) {
          if (numParts[0] > 12) {
            monthCandidate = numParts[1];
          } else {
            monthCandidate = numParts[0] <= 12 ? numParts[0] : numParts[1];
          }
        } else {
          monthCandidate = otherParts[0];
        }
      }
    } else {
      // 2-digit numbers only, e.g. ["06", "26"] or ["26", "06"]
      if (numParts[0] <= 12 && numParts[1] > 12) {
        monthCandidate = numParts[0];
        yearCandidate = numParts[1];
      } else if (numParts[1] <= 12 && numParts[0] > 12) {
        monthCandidate = numParts[1];
        yearCandidate = numParts[0];
      } else {
        monthCandidate = numParts[0];
        yearCandidate = numParts[1];
      }
    }

    if (monthCandidate >= 1 && monthCandidate <= 12 && yearCandidate) {
      let year = yearCandidate;
      if (year < 100) {
        if (year > 50) year = 1957 + year;
        else year = 2000 + year;
      } else if (year > 2500) {
        year = year - 543;
      }
      return `${year}-${monthCandidate.toString().padStart(2, "0")}`;
    }
  }

  // 5. Final fallback to native JS Date parsing
  const parsedDate = new Date(str);
  if (!isNaN(parsedDate.getTime())) {
    const year = parsedDate.getFullYear();
    const month = (parsedDate.getMonth() + 1).toString().padStart(2, "0");
    if (year > 1900 && year < 2100) {
      return `${year}-${month}`;
    }
  }

  return null;
}

/**
 * Helper to format "YYYY-MM" (canonical) to the spreadsheet month format (e.g., "01-May-26")
 */
export function formatYyyyMmToSheetMonth(yyyyMm: string): string {
  if (!yyyyMm) return "";
  const parts = yyyyMm.split("-");
  if (parts.length !== 2) return yyyyMm;
  const yearStr = parts[0];
  const monthStr = parts[1];
  
  const monthNum = parseInt(monthStr, 10);
  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) return yyyyMm;
  
  const shortMonths = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  
  const mmm = shortMonths[monthNum - 1];
  const yy = yearStr.substring(2);
  return `01-${mmm}-${yy}`;
}

/**
 * Robustly matches UPS IDs (e.g. "UPS 15A (PPC44A)" vs "UPS 15A")
 */
export function matchUpsId(sheetId: string, appId: string): boolean {
  if (!sheetId || !appId) return false;
  const sClean = String(sheetId).replace(/\s+/g, "").toLowerCase();
  const aClean = String(appId).replace(/\s+/g, "").toLowerCase();
  
  if (sClean === aClean) return true;
  
  // Specific override for UPS 15A / 15B with custom names
  if (sClean.includes("ups15a") && aClean.includes("ups15a")) return true;
  if (sClean.includes("ups15b") && aClean.includes("ups15b")) return true;
  if (sClean.includes("ups11a") && aClean.includes("ups11a")) return true;
  if (sClean.includes("ups11b") && aClean.includes("ups11b")) return true;
  if (sClean.includes("ups13a") && aClean.includes("ups13a")) return true;
  if (sClean.includes("ups13b") && aClean.includes("ups13b")) return true;
  if (sClean.includes("ups14c") && aClean.includes("ups14c")) return true;
  
  if (sClean.startsWith(aClean) || aClean.startsWith(sClean)) return true;
  if (sClean.includes(aClean) || aClean.includes(sClean)) return true;
  return false;
}

/**
 * Robustly matches DC Panel IDs (e.g. "DC PDB41A" vs "PDB41A")
 */
export function matchDcId(sheetId: string, appId: string): boolean {
  if (!sheetId || !appId) return false;
  const sClean = String(sheetId).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const aClean = String(appId).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  
  if (sClean === aClean) return true;
  if (sClean.includes(aClean) || aClean.includes(sClean)) return true;
  return false;
}

/**
 * Helper to safely parse strings with commas and custom symbols into numbers
 */
function parseSafeNumber(val: any): number | null {
  if (val === "" || val === undefined || val === null) return null;
  if (typeof val === "number") return val;
  const str = String(val).replace(/,/g, "").trim();
  if (str === "") return null;
  const num = Number(str);
  return isNaN(num) ? null : num;
}

/**
 * Shared column-header resolver. Kept module-level (rather than duplicated per
 * caller) so Import and the write Diff Engine always agree on which column
 * means what for a given sheet's header row.
 */
function findCol(headers: string[], keywords: string[], defIdx: number): number {
  if (!headers || headers.length === 0) return defIdx;
  const idx = headers.findIndex(h =>
    keywords.some(kw => String(h || "").toLowerCase().includes(kw.toLowerCase()))
  );
  return idx !== -1 ? idx : defIdx;
}

interface UpsColumns { month: number; upsId: number; voltage: number; current: number; loadKw: number; loadKva: number; timestamp: number; }
interface AirColumns { month: number; eb41a: number; eb41b: number; eb42a: number; eb42b: number; timestamp: number; }
interface DcColumns { month: number; panelId: number; voltage: number; current: number; timestamp: number; }
interface EnergyColumns { month: number; buildingEnergy: number; buildingElectricityCost: number; timestamp: number; }

function resolveUpsColumns(headers: string[]): UpsColumns {
  return {
    month: findCol(headers, ["month", "เดือน"], 0),
    upsId: findCol(headers, ["ups id", "ups_id", "ups", "เครื่อง", "ชื่อ"], 1),
    voltage: findCol(headers, ["voltage", "volt", "v", "แรงดัน"], 2),
    current: findCol(headers, ["current", "amp", "a", "กระแส"], 3),
    loadKw: findCol(headers, ["load (kw)", "load_kw", "kw", "โหลด (kw)", "total load (kw)"], 4),
    loadKva: findCol(headers, ["load (kva)", "load_kva", "kva", "โหลด (kva)", "total load (kva)"], 5),
    timestamp: findCol(headers, ["timestamp", "time", "เวลา"], 6)
  };
}

function resolveAirColumns(headers: string[]): AirColumns {
  return {
    month: findCol(headers, ["month", "เดือน"], 0),
    eb41a: findCol(headers, ["eb41a", "eb 41a", "41a"], 1),
    eb41b: findCol(headers, ["eb41b", "eb 41b", "41b"], 2),
    eb42a: findCol(headers, ["eb42a", "eb 42a", "42a"], 3),
    eb42b: findCol(headers, ["eb42b", "eb 42b", "42b"], 4),
    timestamp: findCol(headers, ["timestamp", "time", "เวลา"], 5)
  };
}

function resolveDcColumns(headers: string[]): DcColumns {
  return {
    month: findCol(headers, ["month", "เดือน"], 0),
    panelId: findCol(headers, ["panel id", "panel_id", "panel", "แผง", "ชื่อ"], 1),
    voltage: findCol(headers, ["voltage", "volt", "v", "แรงดัน"], 2),
    current: findCol(headers, ["current", "amp", "a", "กระแส"], 3),
    timestamp: findCol(headers, ["timestamp", "time", "เวลา"], 4)
  };
}

function resolveEnergyColumns(headers: string[]): EnergyColumns {
  return {
    month: findCol(headers, ["month", "เดือน"], 0),
    buildingEnergy: findCol(headers, ["building energy", "building_energy", "bldg energy", "พลังงาน", "kwh", "หน่วย"], 1),
    buildingElectricityCost: findCol(headers, ["cost", "electricity cost", "electricity_cost", "thb", "บาท", "ค่าไฟ"], 2),
    timestamp: findCol(headers, ["timestamp", "time", "เวลา"], 3)
  };
}

/**
 * Ensure all our 4 standard sheets exist with proper headers
 */
export async function ensureSheetsInitialized(accessToken: string, spreadsheetId: string, signal?: AbortSignal): Promise<{ UPS: string; AIR: string; DC: string; ENERGY: string }> {
  const existingSheets = await getSpreadsheetSheets(accessToken, spreadsheetId, signal);

  // Resolve sheet names dynamically
  const resolved = resolveSheetNames(existingSheets);

  const requiredTitles = Object.values(resolved);
  const missing = requiredTitles.filter(t => !existingSheets.includes(t));

  if (missing.length > 0) {
    await createMissingSheets(accessToken, spreadsheetId, missing, signal);
  }

  // Initialize headers
  await initializeSheetHeaders(accessToken, spreadsheetId, resolved.UPS, HEADERS.UPS, signal);
  await initializeSheetHeaders(accessToken, spreadsheetId, resolved.AIR, HEADERS.AIR, signal);
  await initializeSheetHeaders(accessToken, spreadsheetId, resolved.DC, HEADERS.DC, signal);
  await initializeSheetHeaders(accessToken, spreadsheetId, resolved.ENERGY, HEADERS.ENERGY, signal);

  return resolved;
}

/**
 * Read all values from a sheet range
 */
export async function readSheetValues(accessToken: string, spreadsheetId: string, range: string, signal?: AbortSignal): Promise<any[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal
  });
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return data.values || [];
}

/**
 * Write values to a specific range (overwriting)
 */
export async function writeSheetValues(accessToken: string, spreadsheetId: string, range: string, values: any[][]): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to write values: ${errText}`);
  }
}

/**
 * Thrown when an upload's post-write re-read doesn't match what was intended.
 * Callers must treat this as a hard failure - never silently continue as if
 * the write succeeded.
 */
export class VerificationFailedError extends Error {
  mismatches: string[];
  constructor(message: string, mismatches: string[]) {
    super(message);
    this.name = "VerificationFailedError";
    this.mismatches = mismatches;
  }
}

type TabKey = "UPS" | "AIR" | "DC" | "ENERGY";

const LAST_COLUMN: Record<TabKey, string> = { UPS: "G", AIR: "F", DC: "E", ENERGY: "D" };

// Canonical column layout each tab is written in (see Diff/Patch below). Used
// by Verify to interpret a freshly re-read row without needing its header row.
const CANONICAL_COLUMNS: Record<TabKey, { month: number; deviceId: number | null; domain: number[] }> = {
  UPS: { month: 0, deviceId: 1, domain: [2, 3, 4, 5] },
  AIR: { month: 0, deviceId: null, domain: [1, 2, 3, 4] },
  DC: { month: 0, deviceId: 1, domain: [2, 3] },
  ENERGY: { month: 0, deviceId: null, domain: [1, 2] }
};

interface RawTable {
  headers: string[];
  rows: any[][];
}

interface SheetSnapshot {
  resolved: { UPS: string; AIR: string; DC: string; ENERGY: string };
  ups: RawTable;
  air: RawTable;
  dc: RawTable;
  energy: RawTable;
}

interface NormalizedUpsRow { rowNumber: number; month: string; upsId: string; voltage: number | null; current: number | null; loadKw: number | null; loadKva: number | null; }
interface NormalizedAirRow { rowNumber: number; month: string; eb41a: number | null; eb41b: number | null; eb42a: number | null; eb42b: number | null; }
interface NormalizedDcRow { rowNumber: number; month: string; panelId: string; voltage: number | null; current: number | null; }
interface NormalizedEnergyRow { rowNumber: number; month: string; buildingEnergyKwh: number | null; buildingElectricityCostThb: number | null; }

interface SheetIndex {
  upsByMonth: Map<string, NormalizedUpsRow[]>;
  airByMonth: Map<string, NormalizedAirRow[]>;
  dcByMonth: Map<string, NormalizedDcRow[]>;
  energyByMonth: Map<string, NormalizedEnergyRow[]>;
  // Allocates the next row to use for an INSERT into the given tab: reuses a
  // truly-empty row already present in the sheet if one exists, otherwise
  // appends after the last row. Never assumes the data is contiguous.
  allocateRow: (tab: TabKey) => number;
}

/**
 * A row is "truly empty" only if every cell in it is blank. A row with a
 * missing/unparseable month but SOME other value present is not empty - it's
 * flagged separately as an "unexpected blank row" in the integrity report.
 */
function isRowBlank(row: any[]): boolean {
  return row.every(cell => String(cell ?? "").trim() === "");
}

/**
 * Builds a per-tab row allocator that hands out the first truly-empty row it
 * can find in the existing data (reusing gaps), falling back to appending
 * past the last row only once no blank rows remain.
 */
function createRowAllocator(rows: any[][]): () => number {
  const freeRows: number[] = [];
  rows.forEach((row, i) => {
    if (isRowBlank(row)) freeRows.push(i + 2);
  });
  let appendCursor = rows.length + 2;
  return () => {
    const reused = freeRows.shift();
    if (reused !== undefined) return reused;
    return appendCursor++;
  };
}

function groupByMonth<T extends { month: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.month) continue;
    const list = map.get(row.month);
    if (list) list.push(row); else map.set(row.month, [row]);
  }
  return map;
}

/**
 * Groups rows that identify the same real-world entity together (e.g. all
 * sheet rows that fuzzy-match the same UPS ID within the same month), so
 * duplicates can be reported as a single cluster rather than pairwise noise.
 */
function clusterByMatch<T extends { rowNumber: number }>(rows: T[], isMatch: (a: T, b: T) => boolean): T[][] {
  const clusters: T[][] = [];
  const used = new Array(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (used[i]) return;
    const cluster = [row];
    used[i] = true;
    for (let j = i + 1; j < rows.length; j++) {
      if (!used[j] && isMatch(row, rows[j])) {
        cluster.push(rows[j]);
        used[j] = true;
      }
    }
    if (cluster.length > 1) clusters.push(cluster);
  });
  return clusters;
}

/**
 * DOWNLOAD stage: read the current state of all 4 tabs.
 */
async function downloadSheetSnapshot(accessToken: string, spreadsheetId: string, signal?: AbortSignal): Promise<SheetSnapshot> {
  const resolved = await ensureSheetsInitialized(accessToken, spreadsheetId, signal);

  const upsRows = await readSheetValues(accessToken, spreadsheetId, `${resolved.UPS}!A:G`, signal);
  const airRows = await readSheetValues(accessToken, spreadsheetId, `${resolved.AIR}!A:F`, signal);
  const dcRows = await readSheetValues(accessToken, spreadsheetId, `${resolved.DC}!A:E`, signal);
  const energyRows = await readSheetValues(accessToken, spreadsheetId, `${resolved.ENERGY}!A:D`, signal);

  const toTable = (allRows: any[][], fallbackHeaders: string[]): RawTable => ({
    headers: allRows.length > 0 ? allRows[0] : fallbackHeaders,
    rows: allRows.slice(1)
  });

  return {
    resolved,
    ups: toTable(upsRows, HEADERS.UPS),
    air: toTable(airRows, HEADERS.AIR),
    dc: toTable(dcRows, HEADERS.DC),
    energy: toTable(energyRows, HEADERS.ENERGY)
  };
}

/**
 * NORMALIZE + INDEX stages: parse raw rows into typed records (retaining
 * their live sheet row numbers), group them by month for lookup during Diff,
 * and set up a free-row allocator per tab that searches for truly empty rows
 * instead of assuming the data is contiguous.
 */
function indexSheetSnapshot(snapshot: SheetSnapshot): SheetIndex {
  const upsCols = resolveUpsColumns(snapshot.ups.headers);
  const normalizedUps: NormalizedUpsRow[] = snapshot.ups.rows.map((row, i) => ({
    rowNumber: i + 2,
    month: normalizeMonthToYyyyMm(row[upsCols.month]) || "",
    upsId: String(row[upsCols.upsId] ?? ""),
    voltage: parseSafeNumber(row[upsCols.voltage]),
    current: parseSafeNumber(row[upsCols.current]),
    loadKw: parseSafeNumber(row[upsCols.loadKw]),
    loadKva: parseSafeNumber(row[upsCols.loadKva])
  }));

  const airCols = resolveAirColumns(snapshot.air.headers);
  const normalizedAir: NormalizedAirRow[] = snapshot.air.rows.map((row, i) => ({
    rowNumber: i + 2,
    month: normalizeMonthToYyyyMm(row[airCols.month]) || "",
    eb41a: parseSafeNumber(row[airCols.eb41a]),
    eb41b: parseSafeNumber(row[airCols.eb41b]),
    eb42a: parseSafeNumber(row[airCols.eb42a]),
    eb42b: parseSafeNumber(row[airCols.eb42b])
  }));

  const dcCols = resolveDcColumns(snapshot.dc.headers);
  const normalizedDc: NormalizedDcRow[] = snapshot.dc.rows.map((row, i) => ({
    rowNumber: i + 2,
    month: normalizeMonthToYyyyMm(row[dcCols.month]) || "",
    panelId: String(row[dcCols.panelId] ?? ""),
    voltage: parseSafeNumber(row[dcCols.voltage]),
    current: parseSafeNumber(row[dcCols.current])
  }));

  const energyCols = resolveEnergyColumns(snapshot.energy.headers);
  const normalizedEnergy: NormalizedEnergyRow[] = snapshot.energy.rows.map((row, i) => ({
    rowNumber: i + 2,
    month: normalizeMonthToYyyyMm(row[energyCols.month]) || "",
    buildingEnergyKwh: parseSafeNumber(row[energyCols.buildingEnergy]),
    buildingElectricityCostThb: parseSafeNumber(row[energyCols.buildingElectricityCost])
  }));

  const allocators: Record<TabKey, () => number> = {
    UPS: createRowAllocator(snapshot.ups.rows),
    AIR: createRowAllocator(snapshot.air.rows),
    DC: createRowAllocator(snapshot.dc.rows),
    ENERGY: createRowAllocator(snapshot.energy.rows)
  };

  return {
    upsByMonth: groupByMonth(normalizedUps),
    airByMonth: groupByMonth(normalizedAir),
    dcByMonth: groupByMonth(normalizedDc),
    energyByMonth: groupByMonth(normalizedEnergy),
    allocateRow: (tab) => allocators[tab]()
  };
}

/**
 * A full data-quality snapshot of the spreadsheet, independent of any single
 * month being written. Used to gate synchronization (duplicate keys) and to
 * give visibility into the sheet's overall health.
 */
export interface DataIntegrityReport {
  duplicateKeys: { tab: TabKey; month: string; deviceId?: string; rowNumbers: number[] }[];
  missingMonths: { tab: TabKey; month: string }[];
  missingDevices: { tab: TabKey; month: string; deviceId: string }[];
  unexpectedBlankRows: { tab: TabKey; rowNumber: number }[];
  invalidIds: { tab: TabKey; rowNumber: number; rawId: string }[];
}

/**
 * Generates the Data Integrity Report for a downloaded+indexed snapshot.
 * Pure/read-only - does not itself stop anything; callers decide what to do
 * with the findings (writeMonthlyLogTransactional hard-stops on duplicate
 * keys for the month it's about to write).
 */
export function generateDataIntegrityReport(snapshot: SheetSnapshot, index: SheetIndex): DataIntegrityReport {
  const duplicateKeys: DataIntegrityReport["duplicateKeys"] = [];
  const missingMonths: DataIntegrityReport["missingMonths"] = [];
  const missingDevices: DataIntegrityReport["missingDevices"] = [];
  const unexpectedBlankRows: DataIntegrityReport["unexpectedBlankRows"] = [];
  const invalidIds: DataIntegrityReport["invalidIds"] = [];

  // --- Duplicate keys ---
  index.upsByMonth.forEach((rows, month) => {
    clusterByMatch(rows, (a, b) => matchUpsId(a.upsId, b.upsId)).forEach(cluster => {
      duplicateKeys.push({ tab: "UPS", month, deviceId: cluster[0].upsId, rowNumbers: cluster.map(r => r.rowNumber) });
    });
  });
  index.dcByMonth.forEach((rows, month) => {
    clusterByMatch(rows, (a, b) => matchDcId(a.panelId, b.panelId)).forEach(cluster => {
      duplicateKeys.push({ tab: "DC", month, deviceId: cluster[0].panelId, rowNumbers: cluster.map(r => r.rowNumber) });
    });
  });
  index.airByMonth.forEach((rows, month) => {
    if (rows.length > 1) duplicateKeys.push({ tab: "AIR", month, rowNumbers: rows.map(r => r.rowNumber) });
  });
  index.energyByMonth.forEach((rows, month) => {
    if (rows.length > 1) duplicateKeys.push({ tab: "ENERGY", month, rowNumbers: rows.map(r => r.rowNumber) });
  });

  // --- Missing months: present in at least one tab, absent from another ---
  const tabMonthSets: Record<TabKey, Set<string>> = {
    UPS: new Set(index.upsByMonth.keys()),
    AIR: new Set(index.airByMonth.keys()),
    DC: new Set(index.dcByMonth.keys()),
    ENERGY: new Set(index.energyByMonth.keys())
  };
  const allMonths = new Set<string>([...tabMonthSets.UPS, ...tabMonthSets.AIR, ...tabMonthSets.DC, ...tabMonthSets.ENERGY]);
  allMonths.forEach(month => {
    (Object.keys(tabMonthSets) as TabKey[]).forEach(tab => {
      if (!tabMonthSets[tab].has(month)) missingMonths.push({ tab, month });
    });
  });

  // --- Missing devices: month has rows in the tab, but an expected device ID has none ---
  index.upsByMonth.forEach((rows, month) => {
    DEFAULT_UPS_IDS.forEach(id => {
      if (!rows.some(r => matchUpsId(r.upsId, id))) missingDevices.push({ tab: "UPS", month, deviceId: id });
    });
  });
  index.dcByMonth.forEach((rows, month) => {
    DEFAULT_DC_IDS.forEach(id => {
      if (!rows.some(r => matchDcId(r.panelId, id))) missingDevices.push({ tab: "DC", month, deviceId: id });
    });
  });

  // --- Unexpected blank rows + invalid IDs: scan every raw row ---
  const scanTab = (tab: TabKey, table: RawTable, monthColIdx: number, idColIdx: number | null, knownIds: string[] | null, matcher: ((raw: string, known: string) => boolean) | null) => {
    table.rows.forEach((row, i) => {
      const rowNumber = i + 2;
      if (isRowBlank(row)) return; // a fully blank row is an expected, reusable gap - not an issue
      const month = normalizeMonthToYyyyMm(row[monthColIdx]);
      if (!month) {
        unexpectedBlankRows.push({ tab, rowNumber });
        return;
      }
      if (idColIdx !== null && knownIds && matcher) {
        const rawId = String(row[idColIdx] ?? "").trim();
        if (rawId && !knownIds.some(id => matcher(rawId, id))) {
          invalidIds.push({ tab, rowNumber, rawId });
        }
      }
    });
  };

  const upsCols = resolveUpsColumns(snapshot.ups.headers);
  const dcCols = resolveDcColumns(snapshot.dc.headers);
  const airCols = resolveAirColumns(snapshot.air.headers);
  const energyCols = resolveEnergyColumns(snapshot.energy.headers);

  scanTab("UPS", snapshot.ups, upsCols.month, upsCols.upsId, DEFAULT_UPS_IDS, matchUpsId);
  scanTab("DC", snapshot.dc, dcCols.month, dcCols.panelId, DEFAULT_DC_IDS, matchDcId);
  scanTab("AIR", snapshot.air, airCols.month, null, null, null);
  scanTab("ENERGY", snapshot.energy, energyCols.month, null, null, null);

  return { duplicateKeys, missingMonths, missingDevices, unexpectedBlankRows, invalidIds };
}

type DiffOp =
  | { kind: "SKIP"; tab: TabKey }
  | { kind: "UPDATE" | "INSERT"; tab: TabKey; rowNumber: number; month: string; deviceId?: string; domainValues: any[]; values: any[] };

interface DiffResult {
  ops: DiffOp[];
}

interface TouchedRow {
  tab: TabKey;
  range: string;
  month: string;
  deviceId?: string;
  domainValues: any[];
}

interface PatchPlan {
  valueRanges: { range: string; values: any[][] }[];
  touched: TouchedRow[];
}

/**
 * DIFF stage: classify every record in the MonthlyLog being saved as
 * UPDATE (value changed), INSERT (new row), or SKIP (identical - no write).
 * Assumes the caller has already checked generateDataIntegrityReport() for
 * duplicate keys affecting this month and stopped if any were found - by the
 * time Diff runs, at most one existing row is expected per key.
 */
function diffMonthlyLog(index: SheetIndex, log: MonthlyLog): DiffResult {
  const ops: DiffOp[] = [];
  const month = log.month;
  const formattedMonth = formatYyyyMmToSheetMonth(month);

  // --- UPS Loads ---
  const upsCandidates = index.upsByMonth.get(month) ?? [];
  log.ups.forEach(desired => {
    const existing = upsCandidates.find(r => matchUpsId(r.upsId, desired.upsId));
    const domainValues = [desired.voltage, desired.current, desired.loadKw, desired.loadKva];
    const values = [formattedMonth, desired.upsId, desired.voltage ?? "", desired.current ?? "", desired.loadKw ?? "", desired.loadKva ?? "", log.lastSavedUps || ""];
    if (!existing) {
      ops.push({ kind: "INSERT", tab: "UPS", rowNumber: index.allocateRow("UPS"), month, deviceId: desired.upsId, domainValues, values });
    } else if (existing.voltage !== desired.voltage || existing.current !== desired.current || existing.loadKw !== desired.loadKw || existing.loadKva !== desired.loadKva) {
      ops.push({ kind: "UPDATE", tab: "UPS", rowNumber: existing.rowNumber, month, deviceId: desired.upsId, domainValues, values });
    } else {
      ops.push({ kind: "SKIP", tab: "UPS" });
    }
  });

  // --- Air Conditioning (single row per month) ---
  {
    const existing = (index.airByMonth.get(month) ?? [])[0];
    const desired = log.air;
    const domainValues = [desired.eb41a, desired.eb41b, desired.eb42a, desired.eb42b];
    const values = [formattedMonth, desired.eb41a ?? "", desired.eb41b ?? "", desired.eb42a ?? "", desired.eb42b ?? "", log.lastSavedAir || ""];
    if (!existing) {
      ops.push({ kind: "INSERT", tab: "AIR", rowNumber: index.allocateRow("AIR"), month, domainValues, values });
    } else if (existing.eb41a !== desired.eb41a || existing.eb41b !== desired.eb41b || existing.eb42a !== desired.eb42a || existing.eb42b !== desired.eb42b) {
      ops.push({ kind: "UPDATE", tab: "AIR", rowNumber: existing.rowNumber, month, domainValues, values });
    } else {
      ops.push({ kind: "SKIP", tab: "AIR" });
    }
  }

  // --- DC Power Panels ---
  const dcCandidates = index.dcByMonth.get(month) ?? [];
  log.dc.forEach(desired => {
    const existing = dcCandidates.find(r => matchDcId(r.panelId, desired.panelId));
    const domainValues = [desired.voltage, desired.current];
    const values = [formattedMonth, desired.panelId, desired.voltage ?? "", desired.current ?? "", log.lastSavedDc || ""];
    if (!existing) {
      ops.push({ kind: "INSERT", tab: "DC", rowNumber: index.allocateRow("DC"), month, deviceId: desired.panelId, domainValues, values });
    } else if (existing.voltage !== desired.voltage || existing.current !== desired.current) {
      ops.push({ kind: "UPDATE", tab: "DC", rowNumber: existing.rowNumber, month, deviceId: desired.panelId, domainValues, values });
    } else {
      ops.push({ kind: "SKIP", tab: "DC" });
    }
  });

  // --- Energy & Cost (single row per month) ---
  {
    const existing = (index.energyByMonth.get(month) ?? [])[0];
    const desired = log.energyCost;
    const domainValues = [desired.buildingEnergyKwh, desired.buildingElectricityCostThb];
    const values = [formattedMonth, desired.buildingEnergyKwh ?? "", desired.buildingElectricityCostThb ?? "", log.lastSavedEnergyCost || ""];
    if (!existing) {
      ops.push({ kind: "INSERT", tab: "ENERGY", rowNumber: index.allocateRow("ENERGY"), month, domainValues, values });
    } else if (existing.buildingEnergyKwh !== desired.buildingEnergyKwh || existing.buildingElectricityCostThb !== desired.buildingElectricityCostThb) {
      ops.push({ kind: "UPDATE", tab: "ENERGY", rowNumber: existing.rowNumber, month, domainValues, values });
    } else {
      ops.push({ kind: "SKIP", tab: "ENERGY" });
    }
  }

  return { ops };
}

/**
 * PATCH GENERATOR stage: turn non-SKIP diff ops into targeted value-ranges
 * (never a full-column range, never a full-sheet rewrite).
 */
function generatePatch(diff: DiffResult, resolved: { UPS: string; AIR: string; DC: string; ENERGY: string }): PatchPlan {
  const valueRanges: { range: string; values: any[][] }[] = [];
  const touched: TouchedRow[] = [];

  diff.ops.forEach(op => {
    if (op.kind === "SKIP") return;
    const sheetName = resolved[op.tab];
    const lastCol = LAST_COLUMN[op.tab];
    const range = `${sheetName}!A${op.rowNumber}:${lastCol}${op.rowNumber}`;
    valueRanges.push({ range, values: [op.values] });
    touched.push({ tab: op.tab, range, month: op.month, deviceId: op.deviceId, domainValues: op.domainValues });
  });

  return { valueRanges, touched };
}

/**
 * UPLOAD stage: a single batchUpdate call carrying every UPDATE/INSERT range
 * across all 4 tabs. No clearSheetRange, no full-range rewrite.
 */
async function uploadPatch(accessToken: string, spreadsheetId: string, valueRanges: { range: string; values: any[][] }[], signal?: AbortSignal): Promise<void> {
  if (valueRanges.length === 0) return; // everything was SKIP - nothing to upload

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: valueRanges
    }),
    signal
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to upload changes: ${errText}`);
  }
}

function cellsRoughlyEqual(expected: any, actual: any): boolean {
  const numExpected = parseSafeNumber(expected);
  const numActual = parseSafeNumber(actual);
  if (numExpected !== null && numActual !== null) return numExpected === numActual;
  return String(expected ?? "").trim() === String(actual ?? "").trim();
}

/**
 * VERIFY stage: download again and validate every touched row across all 5
 * required dimensions - row identity, month, device ID, category, and domain
 * values. Throws VerificationFailedError on any mismatch; callers must treat
 * this as a hard failure and never mark the sync as successful.
 */
async function verifyPatch(accessToken: string, spreadsheetId: string, touched: TouchedRow[], signal?: AbortSignal): Promise<void> {
  const failures: string[] = [];

  for (const t of touched) {
    const cols = CANONICAL_COLUMNS[t.tab];
    const rows = await readSheetValues(accessToken, spreadsheetId, t.range, signal);
    const actual = rows[0];

    // 1. Row identity - did anything actually land where we wrote it?
    if (!actual || actual.length === 0) {
      failures.push(`[${t.tab}] ${t.range}: row identity check failed - no data found after upload.`);
      continue;
    }

    // 2. Category - true by construction (we read back from the resolved
    //    sheet name for this exact tab); recorded here for completeness.
    if (!(t.tab in CANONICAL_COLUMNS)) {
      failures.push(`[${t.tab}] ${t.range}: category check failed - unrecognized tab.`);
    }

    // 3. Month
    const actualMonth = normalizeMonthToYyyyMm(actual[cols.month]);
    if (actualMonth !== t.month) {
      failures.push(`[${t.tab}] ${t.range}: month mismatch - expected ${t.month}, sheet has ${actualMonth ?? "(unparseable)"}.`);
    }

    // 4. Device ID (UPS/DC only - AIR/ENERGY are month-keyed, no device column)
    if (cols.deviceId !== null && t.deviceId) {
      const actualId = String(actual[cols.deviceId] ?? "");
      const idMatches = t.tab === "UPS" ? matchUpsId(actualId, t.deviceId) : matchDcId(actualId, t.deviceId);
      if (!idMatches) {
        failures.push(`[${t.tab}] ${t.range}: device ID mismatch - expected ${t.deviceId}, sheet has "${actualId}".`);
      }
    }

    // 5. Domain values
    const domainMismatch = cols.domain.some((colIdx, i) => !cellsRoughlyEqual(t.domainValues[i], actual[colIdx]));
    if (domainMismatch) {
      const actualDomain = cols.domain.map(c => actual[c]);
      failures.push(`[${t.tab}] ${t.range}: domain value mismatch - expected [${t.domainValues.join(", ")}], sheet has [${actualDomain.join(", ")}].`);
    }
  }

  if (failures.length > 0) {
    throw new VerificationFailedError(
      `Upload could not be verified: ${failures.length} check(s) failed after re-reading the sheet.`,
      failures
    );
  }
}

/**
 * The transactional write pipeline for a single MonthlyLog:
 * Download -> Normalize -> Index -> [Data Integrity gate] -> Diff -> Patch ->
 * Upload -> Verify -> Commit.
 *
 * Never rewrites an entire sheet and never clears a range. Only rows whose
 * values actually differ are uploaded; a brand new month/ID reuses the first
 * truly empty row found in the sheet (or appends past the end if none
 * exist); identical rows are skipped entirely.
 *
 * If the spreadsheet already contains duplicate rows for the month being
 * written, synchronization is stopped immediately (VerificationFailedError)
 * before anything is uploaded - never silently picks one and continues.
 *
 * Every upload is re-read and validated (row identity, month, device ID,
 * category, domain values) before this function returns success - if
 * verification fails, it throws VerificationFailedError and the caller must
 * not treat the sync as committed.
 *
 * Returns the full Data Integrity Report for the spreadsheet, for visibility
 * into non-fatal issues (missing months/devices, blank-row anomalies,
 * invalid IDs) that don't block this write.
 */
export async function writeMonthlyLogTransactional(accessToken: string, spreadsheetId: string, log: MonthlyLog, signal?: AbortSignal): Promise<{ report: DataIntegrityReport }> {
  const snapshot = await downloadSheetSnapshot(accessToken, spreadsheetId, signal);
  const index = indexSheetSnapshot(snapshot);
  const report = generateDataIntegrityReport(snapshot, index);

  const duplicatesForThisMonth = report.duplicateKeys.filter(d => d.month === log.month);
  if (duplicatesForThisMonth.length > 0) {
    const details = duplicatesForThisMonth.map(d =>
      `[${d.tab}] ${d.month}${d.deviceId ? ` / ${d.deviceId}` : ""} - rows ${d.rowNumbers.join(", ")}`
    );
    throw new VerificationFailedError(
      `Cannot synchronize ${log.month}: duplicate rows already exist in the spreadsheet. Synchronization stopped before any upload.`,
      details
    );
  }

  const diff = diffMonthlyLog(index, log);
  const patch = generatePatch(diff, snapshot.resolved);

  await uploadPatch(accessToken, spreadsheetId, patch.valueRanges, signal);
  await verifyPatch(accessToken, spreadsheetId, patch.touched, signal);

  return { report };
}

/**
 * Import all logs from the Google Sheet, rebuild the MonthlyLog format, and return them
 */
export async function importLogsFromGoogleSheets(accessToken: string, spreadsheetId: string, signal?: AbortSignal): Promise<MonthlyLog[]> {
  const resolved = await ensureSheetsInitialized(accessToken, spreadsheetId, signal);

  // Read all ranges
  const upsRows = await readSheetValues(accessToken, spreadsheetId, `${resolved.UPS}!A:G`, signal);
  const airRows = await readSheetValues(accessToken, spreadsheetId, `${resolved.AIR}!A:F`, signal);
  const dcRows = await readSheetValues(accessToken, spreadsheetId, `${resolved.DC}!A:E`, signal);
  const energyRows = await readSheetValues(accessToken, spreadsheetId, `${resolved.ENERGY}!A:D`, signal);

  // Map columns dynamically (shared resolvers - same rules the write Diff Engine uses)
  const upsCols = resolveUpsColumns(upsRows[0] || []);
  const airCols = resolveAirColumns(airRows[0] || []);
  const dcCols = resolveDcColumns(dcRows[0] || []);
  const energyCols = resolveEnergyColumns(energyRows[0] || []);

  // Find all distinct months across all sheets and normalize them to YYYY-MM
  const monthsSet = new Set<string>();
  
  upsRows.slice(1).forEach(row => {
    const norm = normalizeMonthToYyyyMm(row[upsCols.month]);
    if (norm) monthsSet.add(norm);
  });
  airRows.slice(1).forEach(row => {
    const norm = normalizeMonthToYyyyMm(row[airCols.month]);
    if (norm) monthsSet.add(norm);
  });
  dcRows.slice(1).forEach(row => {
    const norm = normalizeMonthToYyyyMm(row[dcCols.month]);
    if (norm) monthsSet.add(norm);
  });
  energyRows.slice(1).forEach(row => {
    const norm = normalizeMonthToYyyyMm(row[energyCols.month]);
    if (norm) monthsSet.add(norm);
  });

  const months = Array.from(monthsSet).sort();
  const importedLogs: MonthlyLog[] = [];

  for (const m of months) {
    const baseLog = createEmptyLog(m);

    // 1. Map UPS
    const monthUps = upsRows.slice(1).filter(row => normalizeMonthToYyyyMm(row[upsCols.month]) === m);
    if (monthUps.length > 0) {
      baseLog.lastSavedUps = monthUps[0][upsCols.timestamp] || null;
      // Map records using robust ID matcher
      baseLog.ups = baseLog.ups.map(defaultUps => {
        const row = monthUps.find(r => matchUpsId(r[upsCols.upsId], defaultUps.upsId));
        if (row) {
          const v = row[upsCols.voltage];
          const c = row[upsCols.current];
          const kw = row[upsCols.loadKw];
          const kva = row[upsCols.loadKva];
          return {
            ...defaultUps,
            voltage: parseSafeNumber(v),
            current: parseSafeNumber(c),
            loadKw: parseSafeNumber(kw),
            loadKva: parseSafeNumber(kva)
          };
        }
        return defaultUps;
      });
    }

    // 2. Map Air
    const monthAir = airRows.slice(1).find(row => normalizeMonthToYyyyMm(row[airCols.month]) === m);
    if (monthAir) {
      baseLog.lastSavedAir = monthAir[airCols.timestamp] || null;
      const ea = monthAir[airCols.eb41a];
      const eb = monthAir[airCols.eb41b];
      const ec = monthAir[airCols.eb42a];
      const ed = monthAir[airCols.eb42b];
      baseLog.air = {
        eb41a: parseSafeNumber(ea),
        eb41b: parseSafeNumber(eb),
        eb42a: parseSafeNumber(ec),
        eb42b: parseSafeNumber(ed)
      };
    }

    // 3. Map DC
    const monthDc = dcRows.slice(1).filter(row => normalizeMonthToYyyyMm(row[dcCols.month]) === m);
    if (monthDc.length > 0) {
       baseLog.lastSavedDc = monthDc[0][dcCols.timestamp] || null;
       baseLog.dc = baseLog.dc.map(defaultDc => {
        const row = monthDc.find(r => matchDcId(r[dcCols.panelId], defaultDc.panelId));
        if (row) {
          const v = row[dcCols.voltage];
          const c = row[dcCols.current];
          return {
            ...defaultDc,
            voltage: parseSafeNumber(v),
            current: parseSafeNumber(c)
          };
        }
        return defaultDc;
      });
    }

    // 4. Map Energy/Cost
    const monthEnergy = energyRows.slice(1).find(row => normalizeMonthToYyyyMm(row[energyCols.month]) === m);
    if (monthEnergy) {
      baseLog.lastSavedEnergyCost = monthEnergy[energyCols.timestamp] || null;
      const bEnergy = monthEnergy[energyCols.buildingEnergy];
      const bCost = monthEnergy[energyCols.buildingElectricityCost];
      baseLog.energyCost = {
        buildingEnergyKwh: parseSafeNumber(bEnergy),
        buildingElectricityCostThb: parseSafeNumber(bCost)
      };
    }

    importedLogs.push(baseLog);
  }

  return importedLogs;
}
