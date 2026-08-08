export type ReportType =
  | "executive"
  | "dashboard"
  | "rack-capacity"
  | "rack-unit-capacity"
  | "historical"
  | "site-comparison"
  | "monthly-energy"
  | "all";

export type ReportingPeriod = "current" | "single" | "range" | "history";
export type ReportSectionId = "executive" | "dashboard" | "rack-capacity" | "rack-unit-capacity" | "ups" | "air-conditioning" | "dc" | "historical" | "site-comparison" | "appendix";

export interface ReportSection {
  id: ReportSectionId;
  title: string;
  reportTypes: ReportType[];
}

export interface ReportTemplate {
  id: string;
  name: string;
  sections: ReportSectionId[];
  favorite?: boolean;
}

export interface ReportHistoryItem {
  id: string;
  filename: string;
  facility: string;
  month: string;
  pages: number | null;
  createdAt: string;
  path?: string;
}
