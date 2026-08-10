import type { ReportingFormat } from "./ReportingCenter";

export const ExportProvider = {
  isAvailable(format: ReportingFormat): boolean { return format !== "powerpoint"; },
  extension(format: ReportingFormat): string {
    return format === "pdf" ? ".pdf" : format === "png" ? ".png" : format === "zip" ? ".zip" : format === "excel" ? ".xlsx" : format === "csv" ? ".csv" : format === "html" ? ".html" : ".pptx";
  }
};
