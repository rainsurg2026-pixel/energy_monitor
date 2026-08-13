export type Role = "admin" | "user";

export interface SessionUser { id: string; username: string; displayName: string; role: Role; active: true; }
interface ApiResponse<T> { ok: true; data: T; }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function csrfToken(): string | undefined {
  const value = document.cookie.split(";").map(item => item.trim()).find(item => item.startsWith("em_csrf="));
  return value ? decodeURIComponent(value.slice("em_csrf=".length)) : undefined;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = csrfToken();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  const response = await fetch(`/api/v1${path}`, { ...init, method, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null) as ApiResponse<T> | { error?: { code?: string; message?: string } } | null;
  if (!response.ok || !body || !("ok" in body) || body.ok !== true) {
    const error = body && "error" in body ? body.error : undefined;
    throw new ApiError(response.status, error?.code ?? "REQUEST_FAILED", error?.message ?? "The request could not be completed.");
  }
  return body.data;
}

export async function downloadPdf(siteId: number, month: string): Promise<void> {
  const response = await fetch(`/api/v1/sites/${siteId}/reports/pdf?month=${encodeURIComponent(month)}`, { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "PDF_GENERATION_FAILED", "The PDF report could not be generated.");
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Data-Center-Energy-Facility-Monitor-${month}.pdf`;
  link.click();
  URL.revokeObjectURL(link.href);
}
