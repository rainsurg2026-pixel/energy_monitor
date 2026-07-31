import zlib from "node:zlib";
import { validateImageBytes } from "../src/utils/imageValidation";

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

/** Builds a genuinely valid, renderable solid-color PNG (RGB, no filter tricks needed). */
function makeValidPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = 200;
      raw[px + 1] = 60;
      raw[px + 2] = 60;
    }
  }
  const idatData = zlib.deflateSync(raw);
  return Buffer.concat([signature, chunk("IHDR", ihdrData), chunk("IDAT", idatData), chunk("IEND", Buffer.alloc(0))]);
}

/** Builds a minimal, genuinely decodable baseline JPEG via a real encoder
 *  is overkill for this test; instead construct just enough real markers
 *  (SOI, APP0, a valid baseline SOF0 with real width/height, EOI) to prove
 *  the dimension parser reads real data, matching how a browser-exported
 *  JPEG blob's header looks structurally (full entropy-coded scan data is
 *  irrelevant to what this validator inspects). */
function makeMinimalJpegHeader(width: number, height: number): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof0Data = Buffer.alloc(11);
  sof0Data[0] = 0xff;
  sof0Data[1] = 0xc0;
  sof0Data.writeUInt16BE(11, 2); // length (excludes marker bytes)
  sof0Data[4] = 8; // precision
  sof0Data.writeUInt16BE(height, 5);
  sof0Data.writeUInt16BE(width, 7);
  sof0Data[9] = 1; // 1 component (grayscale-ish, irrelevant to this test)
  sof0Data[10] = 0;
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([soi, app0, sof0Data, eoi]);
}

// ---- Real PNG: valid signature + real IHDR dimensions ----
const png = makeValidPng(320, 180);
const pngResult = validateImageBytes(png);
check("valid PNG is accepted", pngResult.ok === true);
if (pngResult.ok) {
  check("PNG type is png", pngResult.image.type === "png");
  check("PNG mimeType is image/png", pngResult.image.mimeType === "image/png");
  check("PNG width read correctly", pngResult.image.width === 320);
  check("PNG height read correctly", pngResult.image.height === 180);
}

// ---- Real JPEG header: valid SOI/APP0/SOF0 with real dimensions ----
const jpeg = makeMinimalJpegHeader(640, 480);
const jpegResult = validateImageBytes(jpeg);
check("valid JPEG is accepted", jpegResult.ok === true);
if (jpegResult.ok) {
  check("JPEG type is jpeg", jpegResult.image.type === "jpeg");
  check("JPEG width read correctly", jpegResult.image.width === 640);
  check("JPEG height read correctly", jpegResult.image.height === 480);
}

// ---- Rejection: filename lies, content doesn't ----
const textMasqueradingAsImage = Buffer.from("this is not an image, just text pretending to be one");
const fakeResult = validateImageBytes(textMasqueradingAsImage);
check("plain text is rejected regardless of any claimed filename/extension", fakeResult.ok === false);
check("rejection reason is unsupported_format", fakeResult.ok === false && fakeResult.reason === "unsupported_format");

// ---- Rejection: truncated/corrupt PNG signature-only ----
const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const truncatedResult = validateImageBytes(truncatedPng);
check("truncated PNG (signature only, no IHDR) is rejected", truncatedResult.ok === false);

// ---- Rejection: empty file ----
const emptyResult = validateImageBytes(new Uint8Array(0));
check("empty file is rejected", emptyResult.ok === false && emptyResult.reason === "empty_file");

// ---- Rejection: oversized file ----
const oversized = Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024)]);
const oversizedResult = validateImageBytes(oversized);
check("file over the size cap is rejected", oversizedResult.ok === false && oversizedResult.reason === "too_large");

console.log(failures === 0 ? "\nALL RACK CAPACITY IMAGE VALIDATION TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
