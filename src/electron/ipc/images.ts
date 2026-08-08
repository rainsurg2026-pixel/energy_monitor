/**
 * IPC surface for the filesystem ImageStorageProvider
 * (src/storage/ImageStorageProvider.ts) - the Rack Unit Capacity monthly
 * image. This is the ONLY place the renderer's data layer touches image
 * bytes; every payload is re-validated here before any filesystem access
 * happens, same trust-boundary posture as ipc/excel.ts.
 */
import { ipcMain } from "electron";
import os from "os";
import { PayloadError } from "../../excel/WorkbookValidator";
import { validateImageBytes } from "../../utils/imageValidation";
import { getRackUnitImagesRootDir, log } from "../paths";
import { wrap } from "./excel";
import * as ImageStorageProvider from "../../storage/ImageStorageProvider";
import type { ImageBytesInput, StoredImageMeta } from "../../storage/ImageStorageProvider";

function sanitizeFacility(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) throw new PayloadError("facility is required.");
  const facility = raw.trim().slice(0, 200);
  if (facility === "." || facility === ".." || /[\\/\0]/.test(facility)) throw new PayloadError("facility contains an invalid path character.");
  return facility;
}

function sanitizeReportingMonth(raw: unknown): string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}$/.test(raw)) throw new PayloadError("reportingMonth ('YYYY-MM') is required.");
  const month = Number(raw.slice(5, 7));
  if (month < 1 || month > 12) throw new PayloadError("reportingMonth must be a valid month.");
  return raw;
}

/** Trust boundary for the uploaded image: the renderer's own validation is
 *  never trusted alone - bytes are re-validated by real magic-number/
 *  dimension parsing here, in the main process, before anything is written
 *  to disk. A crafted "type"/"width"/"height" that doesn't match the actual
 *  bytes is rejected, not merely relabeled. */
function sanitizeImageInput(raw: unknown): ImageBytesInput {
  if (typeof raw !== "object" || raw === null) throw new PayloadError("image must be an object.");
  const o = raw as Record<string, unknown>;
  const bytesInput = o.bytes;
  if (!(bytesInput instanceof Uint8Array)) throw new PayloadError("image.bytes must be raw byte data.");
  const bytes = Buffer.from(bytesInput);
  const validated = validateImageBytes(bytes);
  if (validated.ok === false) throw new PayloadError(`Uploaded file is not a valid PNG/JPEG image (${validated.reason}).`);
  return { bytes, type: validated.image.type, width: validated.image.width, height: validated.image.height };
}

function currentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "unknown";
  }
}

export interface ImageSaveResultPayload {
  meta: StoredImageMeta;
}
export interface ImageLoadResultPayload {
  found: boolean;
  dataUri: string | null;
  meta: StoredImageMeta | null;
}
export interface ImageDeleteResultPayload {
  deleted: boolean;
}
export interface ImageExistsResultPayload {
  exists: boolean;
}
export interface ImageListResultPayload {
  images: StoredImageMeta[];
}

export function registerImageIpc(): void {
  ipcMain.handle("images:save", (_event, raw: unknown) =>
    wrap<ImageSaveResultPayload>("images:save", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const facility = sanitizeFacility(body.facility);
      const reportingMonth = sanitizeReportingMonth(body.reportingMonth);
      const image = sanitizeImageInput(body.image);
      const meta = await ImageStorageProvider.saveImage(getRackUnitImagesRootDir(), facility, reportingMonth, image, currentUser());
      log.info(`rack unit capacity image saved: facility ${facility}, month ${reportingMonth}, file ${meta.fileName}`);
      return { ok: true, meta };
    })
  );

  ipcMain.handle("images:load", (_event, raw: unknown) =>
    wrap<ImageLoadResultPayload>("images:load", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const facility = sanitizeFacility(body.facility);
      const reportingMonth = sanitizeReportingMonth(body.reportingMonth);
      const image = await ImageStorageProvider.loadImage(getRackUnitImagesRootDir(), facility, reportingMonth);
      if (!image) return { ok: true, found: false, dataUri: null, meta: null };
      const { bytes, ...meta } = image;
      return { ok: true, found: true, dataUri: `data:${meta.mimeType};base64,${bytes.toString("base64")}`, meta };
    })
  );

  ipcMain.handle("images:delete", (_event, raw: unknown) =>
    wrap<ImageDeleteResultPayload>("images:delete", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const facility = sanitizeFacility(body.facility);
      const reportingMonth = sanitizeReportingMonth(body.reportingMonth);
      const deleted = await ImageStorageProvider.deleteImage(getRackUnitImagesRootDir(), facility, reportingMonth);
      if (deleted) log.info(`rack unit capacity image deleted: facility ${facility}, month ${reportingMonth}`);
      return { ok: true, deleted };
    })
  );

  ipcMain.handle("images:exists", (_event, raw: unknown) =>
    wrap<ImageExistsResultPayload>("images:exists", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const facility = sanitizeFacility(body.facility);
      const reportingMonth = sanitizeReportingMonth(body.reportingMonth);
      const found = await ImageStorageProvider.exists(getRackUnitImagesRootDir(), facility, reportingMonth);
      return { ok: true, exists: found };
    })
  );

  ipcMain.handle("images:list", (_event, raw: unknown) =>
    wrap<ImageListResultPayload>("images:list", async () => {
      const body = (raw ?? {}) as Record<string, unknown>;
      const facility = sanitizeFacility(body.facility);
      const images = await ImageStorageProvider.listImages(getRackUnitImagesRootDir(), facility);
      return { ok: true, images };
    })
  );
}
