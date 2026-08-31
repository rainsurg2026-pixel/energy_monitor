import { api } from "./api";

export interface WebRackUnitCapacityImage {
  dataUri: string;
  contentType: "image/png" | "image/jpeg";
  byteSize: number;
  sha256: string;
  meta: {
    savedAt: string;
    savedBy: string;
    width: number;
    height: number;
  };
}

interface RackUnitImageSnapshotResponse {
  snapshot: {
    image: {
      available: boolean;
      contentType: "image/png" | "image/jpeg";
      byteSize: number | null;
      sha256: string | null;
      width: number | null;
      height: number | null;
      savedAt: string;
      savedBy: string;
    } | null;
  } | null;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The Rack Unit Capacity image could not be read."));
    reader.readAsDataURL(blob);
  });
}

function readBlobDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dimensions);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The Rack Unit Capacity image dimensions could not be read.")); };
    image.src = url;
  });
}

/** Loads the exact (site, month) image used by the Rack Capacity screen.
 * Metadata identifies the object; the image endpoint is authoritative for
 * the bytes. No latest-month fallback is allowed. */
export async function loadWebRackUnitCapacityImage(siteId: number | null, reportingMonth: string): Promise<WebRackUnitCapacityImage | null> {
  if (siteId === null) return null;
  const snapshotResult = await api<RackUnitImageSnapshotResponse>(`/rack-unit-capacity?siteId=${siteId}&month=${encodeURIComponent(reportingMonth)}`);
  const image = snapshotResult.snapshot?.image;
  if (!image) return null;

  // DB image metadata establishes that an image was saved; the GET endpoint is
  // authoritative for the actual bytes. Do not hide a real image merely because
  // optional derived metadata (dimensions/checksum) has not been backfilled.
  const response = await fetch(`/api/v1/sites/${siteId}/rack-unit-capacity/${encodeURIComponent(reportingMonth)}/image`, { credentials: "include" });
  if (!response.ok) throw new Error(`Rack Unit Capacity image request failed (${response.status}).`);
  const blob = await response.blob();
  const dimensions = image.width !== null && image.height !== null
    ? { width: image.width, height: image.height }
    : await readBlobDimensions(blob);
  return {
    dataUri: await blobToDataUri(blob),
    contentType: image.contentType,
    byteSize: image.byteSize ?? blob.size,
    sha256: image.sha256 ?? "",
    meta: { savedAt: image.savedAt, savedBy: image.savedBy, width: dimensions.width, height: dimensions.height }
  };
}
