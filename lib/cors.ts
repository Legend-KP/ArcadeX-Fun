import { NextResponse } from "next/server";
import { getDeployEnv } from "@/lib/deploy-env";

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_HEADERS = "Content-Type";

function parseOriginList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, "").toLowerCase())
    .filter(Boolean);
}

function appOrigin(): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;
  try {
    const url = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalDevOrigin(origin: string): boolean {
  if (getDeployEnv() !== "development") return false;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function isAllowedCorsOrigin(origin: string): boolean {
  const normalized = origin.trim().replace(/\/$/, "").toLowerCase();
  if (!normalized) return false;
  if (isLocalDevOrigin(normalized)) return true;

  const allowed = parseOriginList(process.env.CORS_ALLOWED_ORIGINS);
  const fromApp = appOrigin();
  if (fromApp) allowed.push(fromApp);

  if (allowed.includes(normalized)) return true;

  let hostname: string;
  try {
    hostname = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }

  const suffixes = parseOriginList(process.env.CORS_ALLOWED_ORIGIN_SUFFIXES);
  for (const suffix of suffixes) {
    const dotted = suffix.startsWith(".") ? suffix : `.${suffix}`;
    if (hostname === dotted.slice(1) || hostname.endsWith(dotted)) {
      return true;
    }
  }

  return false;
}

/** CORS headers so Unity WebGL (allowlisted game CDN origins) can call shell APIs. */
export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("Origin")?.trim() ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    Vary: "Origin",
  };

  if (origin && isAllowedCorsOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

export function handleCorsPreflightRequest(request: Request): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function corsJsonResponse(
  request: Request,
  data: unknown,
  init?: ResponseInit
): NextResponse {
  const headers = new Headers(init?.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }

  return NextResponse.json(data, {
    ...init,
    headers,
  });
}
