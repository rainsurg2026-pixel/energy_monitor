import type { MonthlyLog, PhaseReading, SrinakarinInputSnapshot, UpsRecord } from "../types";

export const SRINAKARIN_AGGREGATE_IDS = [
  "UPS 41A", "UPS 41B", "PPC 41A", "PPC 41B", "PPC 42A", "PPC 42B",
  "PPC 43A", "PPC 43B", "PPC 44A", "PPC 44B"
] as const;

export const SRINAKARIN_DEFAULT_UPS_PHASE_IDS = [
  "UPS 11A", "UPS 11B", "UPS 12A", "UPS 12B", "UPS 13A", "UPS 13B", "UPS 41A", "UPS 41B"
];

export const SRINAKARIN_DEFAULT_AC_PHASE_IDS = [
  "PPC 41A", "PPC 41B", "PPC 42A", "PPC 42B", "PPC 43A", "PPC 43B", "PPC 44A", "PPC 44B"
];

export const SRINAKARIN_DEFAULT_PPC43_CURRENT_IDS = [
  "PPC 43A - R - Panel 1", "PPC 43A - R - Panel 2",
  "PPC 43A - S - Panel 1", "PPC 43A - S - Panel 2",
  "PPC 43A - T - Panel 1", "PPC 43A - T - Panel 2",
  "PPC 43B - R - Panel 1", "PPC 43B - R - Panel 2",
  "PPC 43B - S - Panel 1", "PPC 43B - S - Panel 2",
  "PPC 43B - T - Panel 1", "PPC 43B - T - Panel 2"
];

export const SRINAKARIN_DEFAULT_PPC43_PANEL_IDS = [
  "PPC 43A Panel 1", "PPC 43A Panel 2", "PPC 43B Panel 1", "PPC 43B Panel 2"
];

const PHASES = ["R", "S", "T"] as const;
const normalizeId = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}
function sum(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) : null;
}

function phaseValues(snapshot: SrinakarinInputSnapshot | undefined, source: "upsPhase" | "acPhase", prefix: string, field: keyof PhaseReading): number | null {
  const values = Object.entries(snapshot?.[source] ?? {})
    .filter(([id]) => normalizeId(id).startsWith(`${normalizeId(prefix)} -`))
    .map(([, reading]) => (reading as Partial<PhaseReading>)[field]);
  return average(values);
}

function phaseSums(snapshot: SrinakarinInputSnapshot | undefined, prefix: string, field: keyof PhaseReading): number | null {
  const values = Object.entries(snapshot?.upsPhase ?? {})
    .filter(([id]) => normalizeId(id).startsWith(`${normalizeId(prefix)} -`))
    .map(([, reading]) => (reading as Partial<PhaseReading>)[field]);
  return sum(values);
}

function panelValues(snapshot: SrinakarinInputSnapshot | undefined, prefix: string, field: "loadKw" | "loadKva"): number | null {
  const values = Object.entries(snapshot?.ppc43Panel ?? {})
    .filter(([id]) => normalizeId(id).startsWith(normalizeId(prefix)))
    .map(([, reading]) => reading[field]);
  return sum(values);
}

function ppc43Current(snapshot: SrinakarinInputSnapshot | undefined, prefix: string): number | null {
  const phaseTotals = PHASES.map(phase => sum(
    Object.entries(snapshot?.ppc43Current ?? {})
      .filter(([id]) => normalizeId(id).startsWith(`${normalizeId(prefix)} - ${phase.toLowerCase()} -`))
      .map(([, value]) => value)
  ));
  return average(phaseTotals);
}

function existingRecord(log: MonthlyLog, id: string): UpsRecord | undefined {
  const wanted = normalizeId(id);
  return log.ups.find(record => normalizeId(record.upsId) === wanted);
}

/** Preserves the Srinakarin phase-to-monthly aggregate used by v2.3.1. */
export function calculateSrinakarinAggregate(log: MonthlyLog): UpsRecord[] {
  const snapshot = log.srinakarinInputs;
  return SRINAKARIN_AGGREGATE_IDS.map(id => {
    const existing = existingRecord(log, id);
    const isUps = id.startsWith("UPS ");
    const isPpc43 = id.startsWith("PPC 43");
    const phaseSource = isUps ? "upsPhase" : "acPhase";
    const voltage = phaseValues(snapshot, phaseSource, id, "voltage") ?? existing?.voltage ?? null;
    const current = isPpc43
      ? (ppc43Current(snapshot, id) ?? phaseValues(snapshot, "acPhase", id, "current") ?? existing?.current ?? null)
      : (phaseValues(snapshot, "acPhase", id, "current") ?? (isUps ? phaseValues(snapshot, "upsPhase", id, "current") : null) ?? existing?.current ?? null);
    const loadKw = isPpc43
      ? (panelValues(snapshot, id, "loadKw") ?? existing?.loadKw ?? null)
      : (isUps ? phaseSums(snapshot, id, "loadKw") ?? existing?.loadKw ?? null : existing?.loadKw ?? null);
    const loadKva = isPpc43
      ? (panelValues(snapshot, id, "loadKva") ?? existing?.loadKva ?? null)
      : (isUps ? phaseSums(snapshot, id, "loadKva") ?? existing?.loadKva ?? null : existing?.loadKva ?? null);
    const phases = isUps
      ? Object.fromEntries(
          Object.entries(snapshot?.upsPhase ?? {})
            .filter(([phaseId]) => normalizeId(phaseId).startsWith(`${normalizeId(id)} -`))
            .map(([phaseId, reading]) => [phaseId.trim().slice(-1).toUpperCase(), reading])
        )
      : undefined;
    return {
      upsId: id,
      voltage,
      current,
      loadKw: loadKw ?? null,
      loadKva: loadKva ?? null,
      ...(isUps && Object.keys(phases ?? {}).length > 0 ? { phases } : {})
    };
  });
}

export function cloneSrinakarinInputs(input: SrinakarinInputSnapshot | undefined): SrinakarinInputSnapshot {
  return JSON.parse(JSON.stringify(input ?? { upsPhase: {}, acPhase: {}, ppc43Current: {}, ppc43Panel: {} })) as SrinakarinInputSnapshot;
}
