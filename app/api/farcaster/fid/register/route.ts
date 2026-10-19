import { NextResponse } from "next/server";
import {
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth-session";
import {
  FARCASTER_RECOVERY_PROXY,
  SPONSORED_MINT_DAILY_LIMIT,
} from "@/lib/farcaster/constants";
import { idOf } from "@/lib/farcaster/id-registry";
import { registerSponsoredAccount } from "@/lib/farcaster/neynar";
import { upsertSocialProfile } from "@/lib/farcaster/social-db";
import { buildPlayerId } from "@/lib/player-identity";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { getAddress } from "viem";

export const dynamic = "force-dynamic";

/**
 * Path B step 2: submit sponsored registration (Neynar pays gas + storage).
 * Body must include EIP-712 register signature from the user's custody wallet.
 */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    if (
      !(await checkRateLimit(
        `farcaster:register:${ip}`,
        SPONSORED_MINT_DAILY_LIMIT,
        24 * 60 * 60 * 1000
      ))
    ) {
      return rateLimitResponse();
    }

    const body = (await request.json()) as {
      fid?: number;
      signature?: string;
      custodyAddress?: string;
      deadline?: number;
      fname?: string;
      recoveryAddress?: string;
      displayName?: string;
      pfpUrl?: string;
    };

    if (
      typeof body.fid !== "number" ||
      !body.signature ||
      !body.custodyAddress ||
      typeof body.deadline !== "number"
    ) {
      return NextResponse.json(
        {
          error:
            "fid, signature, custodyAddress, and deadline are required.",
        },
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

    const already = await idOf(custody);
    if (already > 0) {
      return NextResponse.json(
        { error: "Address already owns an FID.", fid: already },
        { status: 409 }
      );
    }

    await registerSponsoredAccount({
      fid: body.fid,
      signature: body.signature,
      requestedUserCustodyAddress: custody,
      deadline: body.deadline,
      fname: body.fname,
      metadata: {
        display_name: body.displayName,
        pfp_url: body.pfpUrl,
        username: body.fname,
      },
    });

    const recovery =
      body.recoveryAddress?.trim() || FARCASTER_RECOVERY_PROXY;

    const playerId = buildPlayerId("evm", custody);
    const profile = await upsertSocialProfile({
      playerId,
      fid: body.fid,
      primaryWallet: custody,
      custodyAddress: custody,
      recoveryAddress: recovery,
      fname: body.fname ?? null,
      displayName: body.displayName ?? null,
      pfpUrl: body.pfpUrl ?? null,
      ecosystem: "evm",
      chainId: 10,
    });

    const token = await createSessionToken({
      playerId,
      address: custody,
      ecosystem: "evm",
      chainId: 10,
      fid: body.fid,
    });

    const response = NextResponse.json({
      ok: true,
      fid: body.fid,
      playerId,
      profile,
      recoveryAddress: recovery,
    });
    response.cookies.set(sessionCookieOptions(token));
    return response;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to register FID.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
