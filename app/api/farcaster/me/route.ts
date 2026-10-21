import { NextResponse } from "next/server";
import { readSessionFromCookies } from "@/lib/auth-session";
import { custodyOf, recoveryOf } from "@/lib/farcaster/id-registry";
import { fetchNeynarUserByFid } from "@/lib/farcaster/neynar";
import {
  fetchSocialProfileByPlayerId,
  isUsernameSkipped,
} from "@/lib/farcaster/social-db";

export const dynamic = "force-dynamic";

/**
 * Signed-in social profile. Email stays here and is omitted from public lookup.
 */
export async function GET() {
  try {
    const session = await readSessionFromCookies();
    if (!session?.fid) {
      return NextResponse.json(
      { signedIn: false },
      {
        status: 401,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      }
    );
    }

    const [profile, usernameSkipped, custody, recovery, neynar] =
      await Promise.all([
        fetchSocialProfileByPlayerId(session.playerId).catch(() => null),
        isUsernameSkipped(session.playerId).catch(() => false),
        custodyOf(session.fid).catch(() => null),
        recoveryOf(session.fid).catch(() => null),
        fetchNeynarUserByFid(session.fid).catch(() => null),
      ]);

    const custodyChanged = Boolean(
      custody &&
        session.address &&
        custody.toLowerCase() !== session.address.toLowerCase()
    );

    return NextResponse.json(
      {
        signedIn: true,
        playerId: session.playerId,
        address: session.address,
        fid: session.fid,
        profile,
        usernameSkipped,
        custody,
        recovery: recovery ?? profile?.recoveryAddress ?? null,
        custodyChanged,
        neynar,
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not load your profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
