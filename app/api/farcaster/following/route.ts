import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { fetchNeynarFollowingFids } from "@/lib/farcaster/neynar";

export const dynamic = "force-dynamic";

/** FIDs the signed-in player follows on Farcaster. Used by the Activity feed. */
export async function GET() {
  const session = await readSessionFromCookies();
  if (!session?.fid) {
    return NextResponse.json(
      { error: "Sign in first." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    const fids = await fetchNeynarFollowingFids(session.fid);
    return NextResponse.json(
      { fid: session.fid, fids },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load who you follow.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
