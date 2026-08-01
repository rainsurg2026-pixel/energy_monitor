import { RACK_CANONICAL_STATUSES, RackCanonicalStatus } from "./rackCapacity";

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

const PRESENTATION_BY_STATUS: Record<RackDisplayStatus, RackStatusPresentation> = {
  "In Use": { status: "In Use", labelEn: "In Use", labelTh: "ใช้งานอยู่", hex: "#10b981" },
  "Available": { status: "Available", labelEn: "Available", labelTh: "ว่าง", hex: "#0ea5e9" },
  "Reserved": { status: "Reserved", labelEn: "Reserved", labelTh: "จองไว้", hex: "#f59e0b" },
  "Pending Dismantle": { status: "Pending Dismantle", labelEn: "Pending Dismantle", labelTh: "รอถอดถอน", hex: "#f43f5e" },
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
