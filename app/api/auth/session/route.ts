import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await readSessionFromCookies();
    if (!session) {
      return NextResponse.json({ session: null });
    }

    return NextResponse.json({ session });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to read session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
