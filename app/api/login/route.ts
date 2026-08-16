import { NextResponse } from "next/server";
import { getAdminPassword } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { password?: string };
    const password = body.password ?? "";

    const expected = getAdminPassword();
    if (!expected) {
      return NextResponse.json(
        { error: "Admin is not configured. Set ADMIN_PASSWORD and redeploy." },
        { status: 503 }
      );
    }

    if (!password || password !== expected) {
      return NextResponse.json({ error: "Wrong password." }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
