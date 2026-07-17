/**
 * Small, framework-free guards shared by the entry workflow.
 * Keeping them outside the component lets regression tests verify the exact
 * state transitions used by workbook/context changes and saves.
 */
export interface MutableRef<T> {
  current: T;
}

/** Drop field-history that may target controls now showing another context. */
export function clearEntryUndoHistory<T>(stack: MutableRef<T[]>): void {
  stack.current = [];
}

/**
 * Synchronously claim the save slot. Returns false while another save owns
 * it, preventing two event handlers from starting overlapping writes before
 * React has rendered the busy state.
 */
export function beginSaveOnce(inFlight: MutableRef<boolean>): boolean {
  if (inFlight.current) return false;
  inFlight.current = true;
  return true;
}

/** Release a save slot after its async operation has settled. */
export function endSaveOnce(inFlight: MutableRef<boolean>): void {
  inFlight.current = false;
}
