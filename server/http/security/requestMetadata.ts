import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import type { Request } from "express";

export interface RequestMetadata {
  readonly requestId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly origin: string | null;
  readonly refererOrigin: string | null;
}

export interface RequestMetadataOptions {
  readonly requestId?: unknown;
  /** Set only when the deployment proxy is trusted to sanitize forwarding headers. */
  readonly trustProxy?: boolean;
}

function header(req: Request, name: string): string | undefined {
  const value = req.header(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function cleanText(value: string | undefined, maxLength: number): string | null {
  if (!value) return null;
  const sanitized = value.replace(/[\u0000-\u001f\u007f\u0080-\u009f]/gu, "").trim().slice(0, maxLength);
  return sanitized || null;
}

function cleanIp(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim().replace(/^\[|\]$/gu, "");
  return isIP(candidate) !== 0 ? candidate : null;
}

function forwardedIp(req: Request): string | null {
  const forwarded = header(req, "x-forwarded-for");
  if (forwarded) {
    for (const candidate of forwarded.split(",")) {
      const ip = cleanIp(candidate);
      if (ip) return ip;
    }
  }
  return cleanIp(header(req, "x-real-ip"));
}

function requestOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === value ? parsed.origin : null;
  } catch {
    return null;
  }
}

function safeRequestId(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(value) ? value : randomUUID();
}

export function sanitizeRequestMetadata(req: Request, options: RequestMetadataOptions = {}): RequestMetadata {
  const userAgent = cleanText(header(req, "user-agent"), 256);
  const originValue = header(req, "origin");
  const referer = header(req, "referer");
  let refererOrigin: string | null = null;
  if (referer) {
    try {
      refererOrigin = requestOrigin(new URL(referer).origin);
    } catch {
      refererOrigin = null;
    }
  }
  return {
    requestId: safeRequestId(options.requestId),
    ip: options.trustProxy ? forwardedIp(req) : cleanIp(req.socket.remoteAddress),
    userAgent,
    origin: requestOrigin(originValue),
    refererOrigin
  };
}
