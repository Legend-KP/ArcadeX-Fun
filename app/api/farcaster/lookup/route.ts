import { NextResponse } from "next/server";
import { idOf, custodyOf, recoveryOf } from "@/lib/farcaster/id-registry";
import {
  fetchNeynarUserByFid,
  fetchNeynarUserByCustodyAddress,
} from "@/lib/farcaster/neynar";
import {
  fetchSocialProfileByFid,
  fetchSocialProfileByUsername,
} from "@/lib/farcaster/social-db";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { toPublicSocialProfile } from "@/lib/farcaster/public-profile";
import { getAddress } from "viem";

export const dynamic = "force-dynamic";

/**
 * Lookup by FID, ArcadeX username, or custody address.
 */
export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`farcaster:lookup:${ip}`, 60, 60_000))) {
      return rateLimitResponse();
    }

    const { searchParams } = new URL(request.url);
    const fidRaw = searchParams.get("fid");
    const username = searchParams.get("username")?.trim();
    const addressRaw = searchParams.get("address")?.trim();

    if (fidRaw) {
      const fid = Number(fidRaw);
      if (!Number.isFinite(fid) || fid <= 0) {
        return NextResponse.json({ error: "Invalid fid." }, { status: 400 });
      }

      const [profile, neynar, custody, recovery] = await Promise.all([
        fetchSocialProfileByFid(fid).catch(() => null),
        fetchNeynarUserByFid(fid).catch(() => null),
        custodyOf(fid).catch(() => null),
        recoveryOf(fid).catch(() => null),
      ]);

      return NextResponse.json({
        fid,
        profile: toPublicSocialProfile(profile),
        neynar,
        custody,
        recovery,
      });
    }

    if (username) {
      const profile = await fetchSocialProfileByUsername(username).catch(
        () => null
      );
      return NextResponse.json({
        username,
        profile: toPublicSocialProfile(profile),
      });
    }

    if (addressRaw) {
      let address: `0x${string}`;
      try {
        address = getAddress(addressRaw);
      } catch {
        return NextResponse.json(
          { error: "Invalid address." },
          { status: 400 }
        );
      }

      const [fid, neynar] = await Promise.all([
        idOf(address),
        fetchNeynarUserByCustodyAddress(address).catch(() => null),
      ]);

      const profile =
        fid > 0
          ? await fetchSocialProfileByFid(fid).catch(() => null)
          : null;

      return NextResponse.json({
        address,
        fid: fid > 0 ? fid : null,
        profile: toPublicSocialProfile(profile),
        neynar,
      });
    }

    return NextResponse.json(
      { error: "Provide fid, username, or address." },
      { status: 400 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
