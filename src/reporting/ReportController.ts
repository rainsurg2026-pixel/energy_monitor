import { ExportProvider } from "./ExportProvider";
import type { ReportRequest } from "./ReportingCenter";

/** UI-facing coordinator boundary. The desktop IPC prepares one canonical
 * HTML document, which is used for both the iframe preview and PDF export. */
export class ReportController {
  constructor(private readonly preview: (month: string) => Promise<void>, private readonly generate: (request: ReportRequest) => Promise<unknown>) {}
  refreshPreview(month: string): Promise<void> { return this.preview(month); }
  generateReport(request: ReportRequest): Promise<unknown> {
    if (!ExportProvider.isAvailable(request.format)) return Promise.reject(new Error("PowerPoint export is coming soon."));
    return this.generate(request);
  }
}
