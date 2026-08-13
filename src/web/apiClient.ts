export type Role = "admin" | "user";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  active: true;
}

interface ApiResponse<T> {
  ok: true;
  data: T;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function csrfToken(): string | undefined {
  const item = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("em_csrf="));
  return item ? decodeURIComponent(item.slice("em_csrf=".length)) : undefined;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) headers.set("x-csrf-token", token);
  }
  const response = await fetch(`/api/v1${path}`, { ...init, method, headers, credentials: "include" });
  const payload = await response.json().catch(() => null) as ApiResponse<T> | { ok?: false; error?: { code?: string; message?: string } } | null;
  if (!response.ok || !payload || payload.ok !== true) {
    const error = payload && "error" in payload ? payload.error : undefined;
    throw new ApiError(response.status, error?.code ?? "REQUEST_FAILED", error?.message ?? "The request could not be completed.");
  }
  return payload.data;
}
