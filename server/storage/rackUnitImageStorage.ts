import { createHash } from "node:crypto";

export interface RackUnitImageStorage {
  putObject(objectKey: string, bytes: Buffer, contentType: "image/png" | "image/jpeg"): Promise<void>;
  getObject(objectKey: string): Promise<Buffer | null>;
  hasObject?(objectKey: string): Promise<boolean>;
  deleteObject(objectKey: string): Promise<void>;
}

function safeObjectKey(objectKey: string): string {
  if (!/^[A-Za-z0-9._/-]+$/.test(objectKey) || objectKey.includes("..") || objectKey.startsWith("/")) {
    throw new Error("Invalid Rack Unit Capacity image object key.");
  }
  return objectKey;
}

function encodedObjectPath(bucket: string, objectKey: string): string {
  return `${encodeURIComponent(bucket)}/${objectKey.split("/").map(segment => encodeURIComponent(segment)).join("/")}`;
}

function logStorageTransportFailure(operation: string, baseUrl: string, bucket: string, error: unknown): void {
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causeCode = cause && typeof cause === "object" && "code" in cause && typeof (cause as { code?: unknown }).code === "string"
    ? (cause as { code: string }).code
    : null;
  const name = error instanceof Error ? error.name : "UNKNOWN_ERROR";
  const message = error instanceof Error ? error.message.replace(/https?:\/\/[^\s]+/gi, "[url]").slice(0, 160) : "";
  let host = "invalid-url";
  try { host = new URL(baseUrl).hostname; } catch { /* keep the safe placeholder */ }
  console.error("Rack Unit Capacity image storage transport failure", { operation, host, bucketConfigured: Boolean(bucket), name, message, causeCode });
}

/** Server-only Supabase Storage adapter. The service-role key is never
 * returned to callers, logged, or sent to the browser. */
export class SupabaseRackUnitImageStorage implements RackUnitImageStorage {
  private readonly baseUrl: string;
  constructor(private readonly supabaseUrl: string, private readonly serviceRoleKey: string, private readonly bucket: string) {
    this.baseUrl = supabaseUrl.replace(/\/+$/, "");
  }

  private headers(contentType?: string): Record<string, string> {
    return {
      Authorization: `Bearer ${this.serviceRoleKey}`,
      apikey: this.serviceRoleKey,
      ...(contentType ? { "Content-Type": contentType } : {})
    };
  }

  async putObject(objectKey: string, bytes: Buffer, contentType: "image/png" | "image/jpeg"): Promise<void> {
    const key = safeObjectKey(objectKey);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/storage/v1/object/${encodedObjectPath(this.bucket, key)}`, {
        method: "POST",
        headers: { ...this.headers(contentType), "x-upsert": "true", "cache-control": "3600" },
        body: bytes
      });
    } catch (error) {
      logStorageTransportFailure("upload", this.baseUrl, this.bucket, error);
      throw error;
    }
    if (!response.ok) throw new Error(`Rack Unit Capacity image storage upload failed (HTTP ${response.status}).`);
  }

  async getObject(objectKey: string): Promise<Buffer | null> {
    const key = safeObjectKey(objectKey);
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${encodedObjectPath(this.bucket, key)}`, { headers: this.headers() });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Rack Unit Capacity image storage read failed (HTTP ${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

  async hasObject(objectKey: string): Promise<boolean> {
    const key = safeObjectKey(objectKey);
    const url = `${this.baseUrl}/storage/v1/object/info/${encodedObjectPath(this.bucket, key)}`;
    const response = await fetch(url, { method: "HEAD", headers: this.headers() });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Rack Unit Capacity image storage availability check failed (HTTP ${response.status}).`);
    return true;
  }

  async deleteObject(objectKey: string): Promise<void> {
    const key = safeObjectKey(objectKey);
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${encodedObjectPath(this.bucket, key)}`, { method: "DELETE", headers: this.headers() });
    if (!response.ok && response.status !== 404) throw new Error(`Rack Unit Capacity image storage delete failed (HTTP ${response.status}).`);
  }
}

export function imageObjectKey(siteCode: string, reportingMonth: string, bytes: Buffer, contentType: "image/png" | "image/jpeg"): string {
  const safeSite = siteCode.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const extension = contentType === "image/jpeg" ? "jpg" : "png";
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `rack-unit-capacity/${safeSite}/${reportingMonth}/${hash}.${extension}`;
}
