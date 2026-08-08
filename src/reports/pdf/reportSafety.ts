/** Keeps the report document self-contained. Images may only be data URIs
 * from ImageStorageProvider; browser/file/network locations are forbidden. */
export function validateReportHtml(html: string): void {
  if (/\bPUE\b|\bCO2\b/i.test(html)) throw new Error("Report validation failed: forbidden content was included.");
  const imageSources = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  for (const src of imageSources) {
    if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/i.test(src)) {
      throw new Error("Report validation failed: only verified embedded PNG/JPEG images are allowed.");
    }
  }
  if (/\b(?:file|https?):\/\//i.test(html)) throw new Error("Report validation failed: external resource paths are not allowed.");
}
