import { NextResponse } from "next/server";

/** Server-only admin password. Never use NEXT_PUBLIC_* for this. */
export function getAdminPassword(): string | null {
  const secret = process.env.ADMIN_PASSWORD?.trim();
  return secret || null;
}

export function verifyAdminRequest(request: Request): boolean {
  const expected = getAdminPassword();
  if (!expected) return false;

  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7) === expected;
  }

  return request.headers.get("X-Admin-Password") === expected;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function apiErrorResponse(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}
