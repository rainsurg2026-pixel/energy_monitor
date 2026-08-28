import { normalizeRackEditableValue, type RackEditableField } from "../domain/rackCapacity";

export type RackEditorRecord = {
  rowNumber: number | null;
  rackZone: string | null;
  rackId: string | null;
  status: string | null;
  cabinetSize: string | null;
  detail: string | null;
  deviceType: string | null;
  remarks: string | null;
};

export interface RackEditorState {
  sourceKey: string;
  baseline: RackEditorRecord[];
  current: RackEditorRecord[];
  dirtyRows: Set<number>;
  saving: boolean;
  error: string | null;
}

const EDITABLE_FIELDS: readonly RackEditableField[] = ["status", "cabinetSize", "detail", "deviceType", "remarks"];

export function rackEditorSourceKey(siteId: number, month: string, rowVersion: number): string {
  return `${siteId}:${month}:${rowVersion}`;
}

export function cloneRackEditorRecords(records: readonly RackEditorRecord[]): RackEditorRecord[] {
  return records.map(record => ({ ...record }));
}

function sameRackRecord(left: RackEditorRecord | undefined, right: RackEditorRecord | undefined): boolean {
  if (!left || !right) return left === right;
  if (left.rowNumber !== right.rowNumber || left.rackZone !== right.rackZone || left.rackId !== right.rackId) return false;
  return EDITABLE_FIELDS.every(field => normalizeRackEditableValue(field, left[field]) === normalizeRackEditableValue(field, right[field]));
}

export function dirtyRackRows(baseline: readonly RackEditorRecord[], current: readonly RackEditorRecord[]): Set<number> {
  const currentByRow = new Map(current.flatMap(record => record.rowNumber === null ? [] : [[record.rowNumber, record] as const]));
  return new Set(baseline.flatMap(record => {
    if (record.rowNumber === null || sameRackRecord(record, currentByRow.get(record.rowNumber))) return [];
    return [record.rowNumber];
  }));
}

export function createRackEditorState(siteId: number, month: string, rowVersion: number, records: readonly RackEditorRecord[]): RackEditorState {
  const cloned = cloneRackEditorRecords(records);
  return { sourceKey: rackEditorSourceKey(siteId, month, rowVersion), baseline: cloneRackEditorRecords(cloned), current: cloned, dirtyRows: new Set(), saving: false, error: null };
}

export function stageRackEditorField(state: RackEditorState, rowNumber: number, field: RackEditableField, value: string | null): RackEditorState {
  const current = state.current.map(record => record.rowNumber === rowNumber ? { ...record, [field]: normalizeRackEditableValue(field, value) } : record);
  return { ...state, current, dirtyRows: dirtyRackRows(state.baseline, current), error: null };
}

export function beginRackEditorSave(state: RackEditorState): RackEditorState {
  return { ...state, saving: true, error: null };
}

export function applyRackEditorSaveSuccess(state: RackEditorState, confirmedRecords: readonly RackEditorRecord[], rowVersion: number): RackEditorState {
  const baseline = cloneRackEditorRecords(confirmedRecords);
  return { sourceKey: state.sourceKey.replace(/:\d+$/, `:${rowVersion}`), baseline: cloneRackEditorRecords(baseline), current: baseline, dirtyRows: new Set(), saving: false, error: null };
}

/** Promote server-confirmed rows after a partial optimistic save. Preserve
 * only fields the operator actually changed; untouched fields take the newer
 * server value and cannot be accidentally written back on the next retry. */
export function applyRackEditorPartialSave(state: RackEditorState, confirmedRecords: readonly RackEditorRecord[], rowVersion: number, appliedRowNumbers: ReadonlySet<number>): RackEditorState {
  const baseline = cloneRackEditorRecords(confirmedRecords);
  const serverByRow = new Map(baseline.flatMap(record => record.rowNumber === null ? [] : [[record.rowNumber, record] as const]));
  const previousBaselineByRow = new Map(state.baseline.flatMap(record => record.rowNumber === null ? [] : [[record.rowNumber, record] as const]));
  const current = state.current.map(record => {
    const serverRecord = record.rowNumber === null ? undefined : serverByRow.get(record.rowNumber);
    if (!serverRecord || record.rowNumber === null || appliedRowNumbers.has(record.rowNumber)) return serverRecord ?? record;
    const previousBaseline = previousBaselineByRow.get(record.rowNumber);
    if (!previousBaseline) return record;
    const merged = { ...serverRecord };
    for (const field of EDITABLE_FIELDS) {
      if (normalizeRackEditableValue(field, record[field]) !== normalizeRackEditableValue(field, previousBaseline[field])) merged[field] = record[field];
    }
    return merged;
  });
  return { ...state, sourceKey: state.sourceKey.replace(/:\d+$/, `:${rowVersion}`), baseline: cloneRackEditorRecords(baseline), current: cloneRackEditorRecords(current), dirtyRows: dirtyRackRows(baseline, current), saving: false, error: null };
}

export function applyRackEditorSaveFailure(state: RackEditorState, error: string): RackEditorState {
  return { ...state, saving: false, error };
}

export function discardRackEditorChanges(state: RackEditorState): RackEditorState {
  const baseline = cloneRackEditorRecords(state.baseline);
  return { ...state, current: baseline, dirtyRows: new Set(), saving: false, error: null };
}
