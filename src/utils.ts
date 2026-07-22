import { MonthlyLog, UpsRecord, AirRecord, DcRecord, EnergyCostRecord } from "./types";

export const DEFAULT_UPS_IDS = [
  "UPS 11A",
  "UPS 11B",
  "UPS 13A",
  "UPS 13B",
  "UPS 14C",
  "UPS 15A (PPC44A)",
  "UPS 15B (PPC44B)"
];

export function isSameUpsId(id1: string, id2: string): boolean {
  if (!id1 || !id2) return false;
  const clean1 = id1.replace(/\s+/g, "").toLowerCase();
  const clean2 = id2.replace(/\s+/g, "").toLowerCase();
  if (clean1 === clean2) return true;
  // If one is "ups15a" and another is "ups15a(ppc44a)"
  if (clean1.includes("ups15a") && clean2.includes("ups15a")) return true;
  if (clean1.includes("ups15b") && clean2.includes("ups15b")) return true;
  if (clean1.includes("ups11a") && clean2.includes("ups11a")) return true;
  if (clean1.includes("ups11b") && clean2.includes("ups11b")) return true;
  if (clean1.includes("ups13a") && clean2.includes("ups13a")) return true;
  if (clean1.includes("ups13b") && clean2.includes("ups13b")) return true;
  if (clean1.includes("ups14c") && clean2.includes("ups14c")) return true;
  return clean1.includes(clean2) || clean2.includes(clean1);
}

export const DEFAULT_DC_IDS = [
  "DC PDB41A",
  "DC PDB41B",
  "DC PDB42A",
  "DC PDB42B"
];

export function createEmptyLog(
  month: string,
  upsIds: string[] = DEFAULT_UPS_IDS,
  dcIds: string[] = DEFAULT_DC_IDS
): MonthlyLog {
  const ups: UpsRecord[] = upsIds.map(id => ({
    upsId: id,
    voltage: null,
    current: null,
    loadKw: null,
    loadKva: null
  }));

  const air: AirRecord = {
    eb41a: null,
    eb41b: null,
    eb42a: null,
    eb42b: null
  };

  const dc: DcRecord[] = dcIds.map(id => ({
    panelId: id,
    voltage: null,
    current: null
  }));

  const energyCost: EnergyCostRecord = {
    buildingEnergyKwh: null,
    buildingElectricityCostThb: null
  };

  return {
    month,
    ups,
    air,
    dc,
    energyCost,
    lastSavedUps: null,
    lastSavedAir: null,
    lastSavedDc: null,
    lastSavedEnergyCost: null
  };
}

// Get the previous month in "YYYY-MM" format
export function getPreviousMonthStr(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
}

// Convert "YYYY-MM" (e.g., "2026-06") to Thai/English display "Jun-26"
export function formatMonthYear(monthStr: string): string {
  if (!monthStr) return "";
  const [yearStr, monthStrPart] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthStrPart, 10) - 1;
  
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  
  const shortYear = year % 100;
  return `${months[monthIdx]}-${shortYear.toString().padStart(2, "0")}`;
}

// Parse "Jun-26" back to "2026-06" (useful for import/backup helper if needed)
export function parseMonthYearDisplay(displayStr: string): string | null {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const parts = displayStr.trim().split("-");
  if (parts.length !== 2) return null;
  const monthName = parts[0];
  const shortYear = parseInt(parts[1], 10);
  if (isNaN(shortYear)) return null;
  
  const monthIdx = months.findIndex(m => m.toLowerCase() === monthName.toLowerCase());
  if (monthIdx === -1) return null;
  
  const fullYear = shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear;
  const monthPart = (monthIdx + 1).toString().padStart(2, "0");
  return `${fullYear}-${monthPart}`;
}

// Format Date object to nice readable Thai/English timestamp e.g. "29-Jun-2026 07:51:56"
export function formatTimestamp(date: Date): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];
  const day = date.getDate().toString().padStart(2, "0");
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

// Storage helpers
const STORAGE_PREFIX = "facility_monthly_logs_";

// In-memory logs store (Do NOT persist to localStorage)
const inMemoryLogs: Record<string, MonthlyLog> = {};

// Clean up any legacy persistent monthly logs from localStorage on load
try {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
} catch (e) {
  console.error("Failed to clean legacy localStorage keys", e);
}

export function loadAllLogs(): MonthlyLog[] {
  const logs = Object.values(inMemoryLogs);
  // Sort by month ascending
  return logs.sort((a, b) => a.month.localeCompare(b.month));
}

export function loadLogForMonth(
  month: string,
  upsIds: string[] = DEFAULT_UPS_IDS,
  dcIds: string[] = DEFAULT_DC_IDS
): MonthlyLog {
  if (inMemoryLogs[month]) {
    const parsed = inMemoryLogs[month];
    const defaults = createEmptyLog(month, upsIds, dcIds);

    // Deep merge ups: every expected device gets a row, defaulted to empty
    // when parsed data has no matching id. `upsIds` must reflect the active
    // facility's real device list here - defaulting to Rangsit's 7 ids would
    // silently drop every device that doesn't happen to fuzzy-match one of
    // them (this previously corrupted Srinakarin's 10-device `ups` array on
    // every call, e.g. via any batched save of a sibling section run after
    // the UPS section).
    const mergedUps = defaults.ups.map(def => {
      const found = parsed.ups?.find(u => isSameUpsId(u.upsId, def.upsId));
      return found ? { ...def, ...found } : def;
    });

    // Deep merge dc (same facility-awareness requirement as ups above).
    const mergedDc = defaults.dc.map(def => {
      const found = parsed.dc?.find(d => d.panelId === def.panelId);
      return found ? { ...def, ...found } : def;
    });

    return {
      ...defaults,
      ...parsed,
      ups: mergedUps,
      dc: mergedDc,
      air: { ...defaults.air, ...parsed.air },
      energyCost: { ...defaults.energyCost, ...parsed.energyCost }
    };
  }
  return createEmptyLog(month, upsIds, dcIds);
}

export function saveLogForMonth(month: string, log: MonthlyLog) {
  inMemoryLogs[month] = log;
}

export function deleteLogForMonth(month: string) {
  delete inMemoryLogs[month];
}

// Generate mock initial data for the current year if database is empty
export function initializeSampleData() {
  const currentLogs = loadAllLogs();
  if (currentLogs.length === 0) {
    // Generate data for past 3 months
    const today = new Date();
    for (let i = 3; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const year = d.getFullYear();
      const monthPart = (d.getMonth() + 1).toString().padStart(2, "0");
      const monthStr = `${year}-${monthPart}`;
      
      const log = createEmptyLog(monthStr);
      
      // Inject realistic sample data
      log.ups = log.ups.map((u, idx) => ({
        ...u,
        voltage: 220 + Math.floor(Math.sin(idx + i) * 5),
        current: 15 + Math.floor(Math.sin(idx * i) * 8),
        loadKw: 3.2 + Math.floor(Math.cos(idx + i) * 1.5 * 10) / 10,
        loadKva: 3.5 + Math.floor(Math.cos(idx + i) * 1.7 * 10) / 10
      }));
      
      log.air = {
        eb41a: 1.2 + i * 0.15 + Math.random() * 0.05,
        eb41b: 0.9 + i * 0.10 + Math.random() * 0.04,
        eb42a: 1.5 + i * 0.20 + Math.random() * 0.06,
        eb42b: 1.1 + i * 0.12 + Math.random() * 0.05
      };
      
      log.dc = log.dc.map((p, idx) => ({
        ...p,
        voltage: 54 + Math.floor(Math.sin(idx + i) * 2),
        current: 80 + Math.floor(Math.cos(idx - i) * 20)
      }));
      
      log.energyCost = {
        buildingEnergyKwh: 45000 + i * 2500 + Math.floor(Math.random() * 1000),
        buildingElectricityCostThb: 180000 + i * 11000 + Math.floor(Math.random() * 4000)
      };
      
      const saveTime = new Date(d.getFullYear(), d.getMonth() + 1, 1, 8, 30, 0);
      const timestamp = formatTimestamp(saveTime);
      log.lastSavedUps = timestamp;
      log.lastSavedAir = timestamp;
      log.lastSavedDc = timestamp;
      log.lastSavedEnergyCost = timestamp;
      
      saveLogForMonth(monthStr, log);
    }
  }
}
