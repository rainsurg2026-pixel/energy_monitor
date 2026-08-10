import { HttpError } from "../errors";

export interface ObjectStorage {
  put(objectKey: string, content: Buffer, contentType: string): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
}

function storagePath(bucket: string, objectKey: string): string {
  const encoded = objectKey.split("/").map(segment => encodeURIComponent(segment)).join("/");
  return `/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`;
}

/** Server-only Supabase Storage adapter. The service-role key is never sent
 * to the browser and is read only by the configured runtime. */
export class SupabaseObjectStorage implements ObjectStorage {
  constructor(private readonly baseUrl: string, private readonly serviceRoleKey: string, private readonly bucket: string) {}

  private headers(contentType?: string): Record<string, string> {
    return {
      authorization: `Bearer ${this.serviceRoleKey}`,
      apikey: this.serviceRoleKey,
      ...(contentType ? { "content-type": contentType } : {})
    };
  }

  async put(objectKey: string, content: Buffer, contentType: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${storagePath(this.bucket, objectKey)}`, {
      method: "POST",
      headers: { ...this.headers(contentType), "x-upsert": "false" },
      body: content
    });
    if (!response.ok && response.status !== 409) throw new HttpError(503, "WORKBOOK_STORAGE_WRITE_FAILED", "The workbook could not be retained in object storage.");
  }

  async get(objectKey: string): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl}${storagePath(this.bucket, objectKey)}`, { headers: this.headers() });
    if (response.status === 404) throw new HttpError(404, "WORKBOOK_SOURCE_NOT_FOUND", "The retained source workbook could not be found.");
    if (!response.ok) throw new HttpError(503, "WORKBOOK_STORAGE_READ_FAILED", "The retained source workbook could not be read.");
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(objectKey: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${storagePath(this.bucket, objectKey)}`, { method: "DELETE", headers: this.headers() });
    if (!response.ok && response.status !== 404) throw new HttpError(503, "WORKBOOK_STORAGE_DELETE_FAILED", "The retained source workbook could not be removed.");
  }
}

/** Deterministic test double; it follows the same immutable object contract. */
export class InMemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Buffer>();

  async put(objectKey: string, content: Buffer, _contentType: string): Promise<void> {
    if (this.objects.has(objectKey)) return;
    this.objects.set(objectKey, Buffer.from(content));
  }

  async get(objectKey: string): Promise<Buffer> {
    const content = this.objects.get(objectKey);
    if (!content) throw new HttpError(404, "WORKBOOK_SOURCE_NOT_FOUND", "The retained source workbook could not be found.");
    return Buffer.from(content);
  }

  async delete(objectKey: string): Promise<void> { this.objects.delete(objectKey); }
}
