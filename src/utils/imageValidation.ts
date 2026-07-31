/**
 * Validates image content by magic bytes (never by filename/extension) and
 * extracts pixel dimensions, so the Rack Capacity K9 image slot can be sized
 * with the correct aspect ratio. Pure byte-level logic - works identically
 * in the renderer (immediate feedback before upload) and the Electron main
 * process (defense-in-depth re-validation before anything is written to the
 * workbook; the renderer's check is never trusted alone).
 */

export type ValidatedImageType = "png" | "jpeg";

export interface ValidatedImage {
  type: ValidatedImageType;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

export type ImageValidationResult = { ok: true; image: ValidatedImage } | { ok: false; reason: string };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte
  // "IHDR", then width(4)/height(4) big-endian.
  if (bytes.length < 24) return null;
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return width > 0 && height > 0 ? { width: width >>> 0, height: height >>> 0 } : null;
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // Scan JFIF/EXIF markers for the first Start-Of-Frame segment (SOF0-SOF15,
  // excluding DHT/JPG extension markers) which carries width/height.
  let offset = 2; // skip the leading 0xFFD8
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) return null; // EOI reached with no SOF found
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + segmentLength;
  }
  return null;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function validateImageBytes(bytes: Uint8Array): ImageValidationResult {
  if (bytes.length === 0) return { ok: false, reason: "empty_file" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "too_large" };

  if (matchesSignature(bytes, PNG_SIGNATURE)) {
    const dims = readPngDimensions(bytes);
    if (!dims) return { ok: false, reason: "corrupt_png" };
    return { ok: true, image: { type: "png", mimeType: "image/png", ...dims } };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const dims = readJpegDimensions(bytes);
    if (!dims) return { ok: false, reason: "corrupt_jpeg" };
    return { ok: true, image: { type: "jpeg", mimeType: "image/jpeg", ...dims } };
  }
  return { ok: false, reason: "unsupported_format" };
}
