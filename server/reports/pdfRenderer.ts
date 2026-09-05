import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

export const MAX_REPORT_HTML_BYTES = 12 * 1024 * 1024;
export const MAX_REPORT_PAGES = 60;

const require = createRequire(import.meta.url);
let reportFontCssPromise: Promise<string> | null = null;

function reportPageCount(html: string): number {
  return (html.match(/<section\b[^>]*class=["'][^"']*\b(?:cover|page)\b[^"']*["']/gi) ?? []).length;
}

export function validateReportHtml(html: string): void {
  if (typeof html !== "string" || html.length === 0) throw new Error("Report HTML is required.");
  if (Buffer.byteLength(html, "utf8") > MAX_REPORT_HTML_BYTES) throw new Error("Report HTML exceeds the permitted size.");
  if (!/<html\b/i.test(html) || !/<head\b/i.test(html) || !/<body\b/i.test(html)) throw new Error("Report HTML must be a complete document.");
  const pages = reportPageCount(html);
  if (pages < 1 || pages > MAX_REPORT_PAGES) throw new Error("Report page count is outside the permitted range.");
}
async function loadReportFontCss(): Promise<string> {
  if (reportFontCssPromise) return reportFontCssPromise;
  reportFontCssPromise = (async () => {
    const faces = [
      { path: require.resolve("@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff2"), weight: 400, range: "U+0000-00FF" },
      { path: require.resolve("@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2"), weight: 400, range: "U+0E00-0E7F" },
      { path: require.resolve("@fontsource/noto-sans-thai/files/noto-sans-thai-latin-700-normal.woff2"), weight: 700, range: "U+0000-00FF" },
      { path: require.resolve("@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff2"), weight: 700, range: "U+0E00-0E7F" }
    ];
    const rules = await Promise.all(faces.map(async face => {
      const data = (await readFile(face.path)).toString("base64");
      return `@font-face{font-family:'Energy Report Thai';font-style:normal;font-weight:${face.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${face.range}}`;
    }));
    rules.push(`html,body,.cover,.page,.cover *,.page *{font-family:'Energy Report Thai','Open Sans',sans-serif!important}`);
    return rules.join("\n");
  })();
  return reportFontCssPromise;
}

function hardenReportHtml(html: string, fontCss: string): string {
  const security = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">`;
  return html.replace(/<head([^>]*)>/i, match => `${match}${security}<style>${fontCss}</style>`);
}
export async function renderReportPdf(html: string): Promise<Buffer> {
  validateReportHtml(html);
  chromium.setGraphicsMode = false;
  const fontCss = await loadReportFontCss();
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: { width: 1123, height: 794, deviceScaleFactor: 1, isLandscape: true },
    executablePath: await chromium.executablePath(),
    headless: "shell"
  });

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = request.url();
      if (url === "about:blank" || url.startsWith("data:") || url.startsWith("blob:")) void request.continue();
      else void request.abort("blockedbyclient");
    });
    await page.setContent(hardenReportHtml(html, fontCss), { waitUntil: "load", timeout: 30_000 });
    await page.evaluate("document.fonts.ready");
    await page.emulateMediaType("print");
    const bytes = await page.pdf({ format: "A4", landscape: true, printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    return Buffer.from(bytes);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

