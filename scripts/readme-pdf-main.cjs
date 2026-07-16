// Electron micro-app: renders docs/desktop/README.md to docs/desktop/README.pdf
// via Chromium's print engine. Run through scripts/make-readme-pdf.mjs.
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mdPath = path.join(root, "docs", "desktop", "README.md");
const pdfPath = path.join(root, "docs", "desktop", "README.pdf");

function mdToHtml(md) {
  const escape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split(/\r?\n/);
  const out = [];
  let inCode = false;
  let inList = false;
  let inQuote = false;
  let tableBuf = [];

  const flushTable = () => {
    if (tableBuf.length < 2) {
      tableBuf.forEach(l => out.push(`<p>${inline(l)}</p>`));
      tableBuf = [];
      return;
    }
    const rows = tableBuf.filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l));
    out.push("<table>");
    rows.forEach((row, i) => {
      const cells = row.replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
      const tag = i === 0 ? "th" : "td";
      out.push("<tr>" + cells.map(c => `<${tag}>${c}</${tag}>`).join("") + "</tr>");
    });
    out.push("</table>");
    tableBuf = [];
  };

  const inline = t =>
    escape(t)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<u>$1</u>");

  const closeBlocks = () => {
    if (inList) { out.push("</ul>"); inList = false; }
    if (inQuote) { out.push("</blockquote>"); inQuote = false; }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushTable();
      closeBlocks();
      out.push(inCode ? "</pre>" : "<pre>");
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(escape(line)); continue; }
    if (/^\s*\|/.test(line)) { tableBuf.push(line); continue; }
    flushTable();

    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { closeBlocks(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)/) || line.match(/^\s*\d+\.\s+(.*)/);
    if (li) {
      if (inQuote) { out.push("</blockquote>"); inQuote = false; }
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      if (!inQuote) { out.push("<blockquote>"); inQuote = true; }
      out.push(`<p>${inline(line.replace(/^>\s?/, ""))}</p>`);
      continue;
    }
    closeBlocks();
    if (line.trim() === "") continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  flushTable();
  closeBlocks();
  if (inCode) out.push("</pre>");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:"Segoe UI",sans-serif;font-size:11px;color:#1e293b;margin:36px;line-height:1.55}
    h1{font-size:20px;border-bottom:2px solid #4f46e5;padding-bottom:6px}
    h2{font-size:14px;margin-top:20px;color:#312e81}
    h3{font-size:12px}
    code{background:#eef2ff;padding:1px 4px;border-radius:3px;font-family:Consolas,monospace;font-size:10px}
    pre{background:#0f172a;color:#e2e8f0;padding:10px;border-radius:6px;font-family:Consolas,monospace;font-size:10px;line-height:1.45}
    table{border-collapse:collapse;width:100%;margin:8px 0}
    th,td{border:1px solid #cbd5e1;padding:4px 8px;text-align:left;font-size:10px}
    th{background:#eef2ff}
    blockquote{border-left:3px solid #f59e0b;margin:8px 0;padding:2px 12px;color:#92400e;background:#fffbeb}
    ul{margin:4px 0;padding-left:20px}
  </style></head><body>${out.join("\n")}</body></html>`;
}

app.whenReady().then(async () => {
  try {
    const html = mdToHtml(fs.readFileSync(mdPath, "utf8"));
    const tmpHtml = path.join(root, "docs", "desktop", ".readme-tmp.html");
    fs.writeFileSync(tmpHtml, html);
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await win.loadFile(tmpHtml);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4" });
    fs.writeFileSync(pdfPath, pdf);
    fs.unlinkSync(tmpHtml);
    console.log(`PDF written: ${pdfPath} (${pdf.length} bytes)`);
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
