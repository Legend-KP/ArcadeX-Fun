import { NextResponse } from "next/server";
import {
  getStreakCampaignIdForChain,
  isArcadeXRewardsConfiguredForChain,
} from "@/lib/arcadex-rewards";
import { getStreakProgressCached } from "@/lib/streak-progress-cache";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  isStreakWalletAddress,
  normalizeStreakWalletAddress,
} from "@/lib/streak-wallet";
import { createWalletSessionToken } from "@/lib/wallet-session";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";

export const dynamic = "force-dynamic";

/** Aligns with wallet session JWT TTL — daily check-in is the sign-in ceremony. */
const SESSION_TTL_SEC = 24 * 60 * 60;

/**
 * Mint a wallet session JWT from a recent on-chain daily check-in.
 * No personal_sign — check-in within the last 24h (and not due again) is required.
 */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-session:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      campaignId?: number;
      chainId?: number;
    };

    const rawWallet = body.walletAddress?.trim() ?? "";
    const chainId =
      typeof body.chainId === "number" && Number.isFinite(body.chainId)
        ? body.chainId
        : PRIMARY_EVM_CHAIN_ID;
    const campaignId =
      typeof body.campaignId === "number" && Number.isFinite(body.campaignId)
        ? body.campaignId
        : getStreakCampaignIdForChain(chainId);

    if (!isArcadeXRewardsConfiguredForChain(chainId)) {
      return NextResponse.json(
        { error: "Streak rewards are not configured yet.", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }

    if (!rawWallet || !isStreakWalletAddress(chainId, rawWallet)) {
      return NextResponse.json(
        { error: "walletAddress is required.", code: "NO_WALLET" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(campaignId) || campaignId < 1) {
      return NextResponse.json(
        { error: "Invalid campaignId.", code: "INVALID_CAMPAIGN" },
        { status: 400 }
      );
    }

    const wallet = normalizeStreakWalletAddress(chainId, rawWallet);
    if (!(await checkRateLimit(`streak-session-wallet:${wallet}`, 20, 60_000))) {
      return rateLimitResponse();
    }

    // Auth gate must not use a stale canCheckIn after an on-chain check-in.
    const status = await getStreakProgressCached(wallet, campaignId, {
      fresh: true,
      chainId,
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const lastCheckInAt = Number(status.lastCheckInAt) || 0;
    const ageSec = lastCheckInAt > 0 ? nowSec - lastCheckInAt : Number.POSITIVE_INFINITY;

    if (!lastCheckInAt || ageSec > SESSION_TTL_SEC) {
      return NextResponse.json(
        {
          error: "Daily check-in required. Please check in to continue.",
          code: "NEED_CHECKIN",
        },
        { status: 401 }
      );
    }

    if (status.canCheckIn) {
      return NextResponse.json(
        {
          error: "Daily check-in required. Please check in to continue.",
          code: "NEED_CHECKIN",
        },
        { status: 401 }
      );
    }

    const token = await createWalletSessionToken(wallet);
    return NextResponse.json({
      ok: true,
      token,
      walletAddress: wallet,
      chainId,
      expiresIn: SESSION_TTL_SEC,
      lastCheckInAt,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to refresh session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
