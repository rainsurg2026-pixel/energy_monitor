import assert from "node:assert/strict";
import { SupabaseRackUnitImageStorage } from "./rackUnitImageStorage";

const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; method?: string }> = [];
try {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method });
    return new Response(null, { status: 404 });
  }) as typeof fetch;

  const storage = new SupabaseRackUnitImageStorage("https://example.supabase.co", "test-service-role-key", "rack-unit-capacity");
  assert.equal(await storage.hasObject("rack-unit-capacity/srinakarin/2026-07/example.jpg"), false);
  assert.equal(requests[0]?.method, "HEAD");
  assert.match(requests[0]?.url ?? "", /\/storage\/v1\/object\/info\/rack-unit-capacity\/rack-unit-capacity\/srinakarin\/2026-07\/example\.jpg$/);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("rack unit image storage: availability uses a read-only HEAD probe");
