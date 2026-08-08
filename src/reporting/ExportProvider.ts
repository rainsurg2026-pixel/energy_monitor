import type { ReportingFormat } from "./ReportingCenter";

export const ExportProvider = {
  isAvailable(format: ReportingFormat): boolean { return format !== "powerpoint"; },
  extension(format: ReportingFormat): string {
    return format === "pdf" ? ".pdf" : format === "excel" ? ".xlsx" : format === "html" ? ".html" : ".pptx";
  }
};
