import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import * as ImageStorageProvider from "../src/storage/ImageStorageProvider";

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}
function makeValidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = rgb[0];
      raw[px + 1] = rgb[1];
      raw[px + 2] = rgb[2];
    }
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([signature, chunk("IHDR", ihdrData), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

const workDir = path.resolve("dist-electron/test-work/image-storage-provider");
await fs.rm(workDir, { recursive: true, force: true });
await fs.mkdir(workDir, { recursive: true });

// ---- Filename convention: RUC-<Mon>-<YY>.png ----
const png = makeValidPng(200, 100, [40, 160, 90]);
const rangsitMeta = await ImageStorageProvider.saveImage(workDir, "Rangsit", "2026-01", { bytes: png, type: "png", width: 200, height: 100 }, "alice");
check("filename follows RUC-<Mon>-<YY>.png convention", rangsitMeta.fileName === "RUC-Jan-26.png");
check("file actually exists on disk at data/<Facility>/RUC-<Mon>-<YY>.png", (await fs.stat(path.join(workDir, "Rangsit", "RUC-Jan-26.png"))).isFile());
check("checksum is a real sha256 hex digest", /^[0-9a-f]{64}$/.test(rangsitMeta.checksum));
check("checksum actually matches the saved bytes", rangsitMeta.checksum === crypto.createHash("sha256").update(png).digest("hex"));
check("metadata records facility/reportingMonth/mimeType/dimensions/savedBy", rangsitMeta.facility === "Rangsit" && rangsitMeta.reportingMonth === "2026-01" && rangsitMeta.mimeType === "image/png" && rangsitMeta.width === 200 && rangsitMeta.height === 100 && rangsitMeta.savedBy === "alice");

// ---- Load ----
const loaded = await ImageStorageProvider.loadImage(workDir, "Rangsit", "2026-01");
check("loadImage finds the saved image", loaded !== null);
check("loaded bytes are byte-identical to what was saved", loaded?.bytes.equals(png) === true);
check("loaded metadata matches what was saved", loaded?.checksum === rangsitMeta.checksum && loaded?.savedBy === "alice");

// ---- exists() ----
check("exists() true for a saved month", (await ImageStorageProvider.exists(workDir, "Rangsit", "2026-01")) === true);
check("exists() false for an unsaved month", (await ImageStorageProvider.exists(workDir, "Rangsit", "2026-02")) === false);
check("loadImage returns null for an unsaved month (never a fallback to the nearest month)", (await ImageStorageProvider.loadImage(workDir, "Rangsit", "2026-02")) === null);

// ---- Facility isolation: Srinakarin's same month is a completely separate file ----
const srinakarinPng = makeValidPng(150, 150, [200, 50, 50]);
await ImageStorageProvider.saveImage(workDir, "Srinakarin", "2026-01", { bytes: srinakarinPng, type: "png", width: 150, height: 150 }, "bob");
const rangsitStill = await ImageStorageProvider.loadImage(workDir, "Rangsit", "2026-01");
check("saving Srinakarin's Jan-26 image never touches Rangsit's Jan-26 image", rangsitStill?.bytes.equals(png) === true);
check("Srinakarin's own image is independently readable", (await ImageStorageProvider.loadImage(workDir, "Srinakarin", "2026-01"))?.bytes.equals(srinakarinPng) === true);

// ---- Re-save (replace) in the SAME format: one file, no accumulation ----
const png2 = makeValidPng(200, 100, [10, 10, 10]);
await ImageStorageProvider.saveImage(workDir, "Rangsit", "2026-01", { bytes: png2, type: "png", width: 200, height: 100 }, "carol");
const afterReplace = await ImageStorageProvider.loadImage(workDir, "Rangsit", "2026-01");
check("re-saving the same month replaces the image (new bytes win)", afterReplace?.bytes.equals(png2) === true);
check("re-saving the same month replaces the metadata (savedBy updates)", afterReplace?.savedBy === "carol");
const rangsitDirEntries1 = await fs.readdir(path.join(workDir, "Rangsit"));
check("re-saving never leaves a second image file for the same month", rangsitDirEntries1.filter(f => f.startsWith("RUC-Jan-26.") && (f.endsWith(".png") || f.endsWith(".jpg"))).length === 1);

// ---- Re-save in a DIFFERENT format: old file is removed, not left behind ----
function makeValidJpeg(): Buffer {
  // Minimal-but-real baseline JPEG: SOI, APP0/JFIF, a tiny SOF0, EOI.
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // SOF0 (16x16)
    0xff, 0xd9 // EOI
  ]);
}
const jpeg = makeValidJpeg();
await ImageStorageProvider.saveImage(workDir, "Rangsit", "2026-01", { bytes: jpeg, type: "jpeg", width: 16, height: 16 }, "dave");
const rangsitDirEntries2 = await fs.readdir(path.join(workDir, "Rangsit"));
check("switching format removes the old .png file", !rangsitDirEntries2.includes("RUC-Jan-26.png"));
check("switching format writes the new .jpg file", rangsitDirEntries2.includes("RUC-Jan-26.jpg"));
check("still exactly one image file for this month after a format switch", rangsitDirEntries2.filter(f => f.startsWith("RUC-Jan-26.") && (f.endsWith(".png") || f.endsWith(".jpg"))).length === 1);
const afterFormatSwitch = await ImageStorageProvider.loadImage(workDir, "Rangsit", "2026-01");
check("loadImage finds the jpeg after the format switch", afterFormatSwitch?.mimeType === "image/jpeg" && afterFormatSwitch.bytes.equals(jpeg) === true);

// ---- listImages ----
await ImageStorageProvider.saveImage(workDir, "Rangsit", "2026-03", { bytes: png, type: "png", width: 200, height: 100 }, "erin");
const listed = await ImageStorageProvider.listImages(workDir, "Rangsit");
check("listImages returns every saved month for the facility", listed.length === 2 && listed.some(m => m.reportingMonth === "2026-01") && listed.some(m => m.reportingMonth === "2026-03"));
check("listImages is sorted by reportingMonth ascending", listed[0].reportingMonth < listed[1].reportingMonth);
check("listImages never includes the image bytes themselves", !("bytes" in listed[0]));
check("listImages for a facility with nothing saved returns an empty array, not an error", (await ImageStorageProvider.listImages(workDir, "NoSuchFacility")).length === 0);

// ---- deleteImage ----
const deleted = await ImageStorageProvider.deleteImage(workDir, "Rangsit", "2026-03");
check("deleteImage returns true when a file was actually removed", deleted === true);
check("deleteImage returns false for an already-absent month (idempotent)", (await ImageStorageProvider.deleteImage(workDir, "Rangsit", "2026-03")) === false);
check("deleted image no longer loads", (await ImageStorageProvider.loadImage(workDir, "Rangsit", "2026-03")) === null);
check("deleting one month never disturbs another month's image", (await ImageStorageProvider.exists(workDir, "Rangsit", "2026-01")) === true);

// ---- Metadata sidecar corruption degrades gracefully, never crashes ----
const dec = await ImageStorageProvider.saveImage(workDir, "Rangsit", "2026-12", { bytes: png, type: "png", width: 200, height: 100 }, "frank");
await fs.writeFile(path.join(workDir, "Rangsit", `${dec.fileName}.json`), "{not valid json");
const corruptRead = await ImageStorageProvider.loadImage(workDir, "Rangsit", "2026-12");
check("a corrupt metadata sidecar still returns the real image bytes (reconstructed metadata)", corruptRead !== null && corruptRead.bytes.equals(png) === true);

console.log(failures === 0 ? "\nALL IMAGE STORAGE PROVIDER TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
