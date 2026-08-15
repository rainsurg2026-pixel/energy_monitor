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

/** Loads the exact (site, month) image used by the Rack Capacity screen.
 * Metadata identifies the object; the image endpoint is authoritative for
 * the bytes. No latest-month fallback is allowed. */
export async function loadWebRackUnitCapacityImage(siteId: number | null, reportingMonth: string): Promise<WebRackUnitCapacityImage | null> {
  if (siteId === null) return null;
  const snapshotResult = await api<RackUnitImageSnapshotResponse>(`/rack-unit-capacity?siteId=${siteId}&month=${encodeURIComponent(reportingMonth)}`);
  const image = snapshotResult.snapshot?.image;
  if (!image || image.width === null || image.height === null || !image.sha256) return null;

  const response = await fetch(`/api/v1/sites/${siteId}/rack-unit-capacity/${encodeURIComponent(reportingMonth)}/image`, { credentials: "include" });
  if (!response.ok) throw new Error(`Rack Unit Capacity image request failed (${response.status}).`);
  const blob = await response.blob();
  return {
    dataUri: await blobToDataUri(blob),
    contentType: image.contentType,
    byteSize: image.byteSize ?? blob.size,
    sha256: image.sha256,
    meta: { savedAt: image.savedAt, savedBy: image.savedBy, width: image.width, height: image.height }
  };
}
