import { RACK_CANONICAL_STATUSES, RackCanonicalStatus } from "./rackCapacity";
import { utilizationColorHex } from "./capacityHealth";

/** The 4 real statuses plus the aggregate "Other" bucket - every status a
 *  Rack Capacity view can ever need to render. */
export type RackDisplayStatus = RackCanonicalStatus | "Other";

export interface RackStatusPresentation {
  status: RackDisplayStatus;
  labelEn: string;
  labelTh: string;
  /** Raw hex - the only form usable by the Recharts donut (SVG fill) and by
   *  the PDF's hand-rolled SVG. UI progress bars/dots consume the same hex
   *  via a Tailwind arbitrary-value class so every view paints identical
   *  pixels for a given status, never a per-component approximation. */
  hex: string;
}

/** The single canonical order every Rack Capacity view (summary cards,
 *  donut, legend, zone table, history, PDF) must render in. "Other" is
 *  appended last and only rendered by callers when it actually has data -
 *  never maintain a second, separately-ordered status array. */
export const RACK_STATUS_DISPLAY_ORDER: readonly RackDisplayStatus[] = [...RACK_CANONICAL_STATUSES, "Other"];

/** In Use's fixed hex here is only a fallback for callers with no ratio
 *  available (e.g. a bare legend swatch) - everywhere a ratio exists, its
 *  color is the dynamic utilization gradient instead (see
 *  `rackStatusColorForRatio`). Kept distinct from Available's green so the
 *  fixed-color set (rackStatusHex) still has 5 mutually distinct colors. */
const PRESENTATION_BY_STATUS: Record<RackDisplayStatus, RackStatusPresentation> = {
  "In Use": { status: "In Use", labelEn: "In Use", labelTh: "ใช้งานอยู่", hex: "#f59e0b" },
  "Available": { status: "Available", labelEn: "Available", labelTh: "ว่าง", hex: "#22c55e" },
  "Reserved": { status: "Reserved", labelEn: "Reserved", labelTh: "จองไว้", hex: "#3b82f6" },
  "Pending Dismantle": { status: "Pending Dismantle", labelEn: "Pending Dismantle", labelTh: "รอถอดถอน", hex: "#ef4444" },
  "Other": { status: "Other", labelEn: "Other", labelTh: "อื่นๆ", hex: "#94a3b8" }
};

export function rackStatusPresentation(status: string): RackStatusPresentation {
  return PRESENTATION_BY_STATUS[status as RackDisplayStatus] ?? PRESENTATION_BY_STATUS.Other;
}

export function rackStatusLabel(status: string, lang: "th" | "en"): string {
  const presentation = rackStatusPresentation(status);
  return lang === "th" ? presentation.labelTh : presentation.labelEn;
}

export function rackStatusHex(status: string): string {
  return rackStatusPresentation(status).hex;
}

/** The color every chart/card/table/heatmap/PDF must use for a status swatch
 *  when a ratio is available: "In Use" is the dynamic utilization gradient
 *  (single source: `utilizationColorHex`), every other status keeps its
 *  fixed color. `ratio` is a 0-1 fraction or null, matching the rest of the
 *  Rack Capacity metrics convention. */
export function rackStatusColorForRatio(status: string, ratio: number | null): string {
  if (status === "In Use") return utilizationColorHex(ratio === null ? null : ratio * 100);
  return rackStatusHex(status);
}
