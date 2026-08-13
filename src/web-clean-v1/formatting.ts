import { formatTimestamp } from "../utils";

/**
 * API timestamps are ISO strings, while the Desktop entry workflow shows
 * saved-at metadata as a local `dd-Mmm-yyyy HH:mm:ss` timestamp. Keep the
 * browser adapter tolerant of legacy text values instead of displaying an
 * "Invalid Date" placeholder or throwing during render.
 */
export function formatWebSavedTimestamp(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : formatTimestamp(parsed);
}
