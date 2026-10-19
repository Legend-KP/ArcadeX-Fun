import { NextResponse } from "next/server";
import { fetchSponsoredFid } from "@/lib/farcaster/neynar";
import { idOf } from "@/lib/farcaster/id-registry";
import { SPONSORED_MINT_DAILY_LIMIT } from "@/lib/farcaster/constants";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { getAddress } from "viem";

export const dynamic = "force-dynamic";

/**
 * Path B step 1: reserve a sponsored FID for the user's custody address.
 * ArcadeX Neynar wallet pays; never drip ETH to the user.
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (
      !(await checkRateLimit(
        `farcaster:mint:${ip}`,
        SPONSORED_MINT_DAILY_LIMIT,
        24 * 60 * 60 * 1000
      ))
    ) {
      return rateLimitResponse();
    }

    const body = (await request.json()) as { custodyAddress?: string };
    if (!body.custodyAddress) {
      return NextResponse.json(
        { error: "custodyAddress is required." },
        { status: 400 }
      );
    }

    let custody: `0x${string}`;
    try {
      custody = getAddress(body.custodyAddress);
    } catch {
      return NextResponse.json(
        { error: "Invalid custody address." },
        { status: 400 }
      );
    }

    const existing = await idOf(custody);
    if (existing > 0) {
      return NextResponse.json(
        {
          error: "Address already owns an FID. Use Sign in with Farcaster.",
          fid: existing,
        },
        { status: 409 }
      );
    }

    const fid = await fetchSponsoredFid();
    return NextResponse.json({
      fid,
      custodyAddress: custody,
      /** Client must register within ~10 minutes with matching wallet id on server. */
      expiresInSeconds: 600,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to reserve FID.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
