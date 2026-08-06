import { NextResponse } from "next/server";
import {
  isArcadeXRewardsConfiguredForChain,
  getStreakCampaignIdForChain,
} from "@/lib/arcadex-rewards";
import { STREAK_PROGRESS_CACHE_MS, getStreakProgressCached } from "@/lib/streak-progress-cache";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { isWalletAddress, normalizeWalletAddress } from "@/lib/wallet-address";
import { PRIMARY_EVM_CHAIN_ID } from "@/lib/chains";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`streak-status:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const rawWallet = searchParams.get("walletAddress")?.trim() ?? "";
    const chainIdRaw = searchParams.get("chainId");
    const chainId =
      chainIdRaw != null && chainIdRaw !== ""
        ? Number(chainIdRaw)
        : PRIMARY_EVM_CHAIN_ID;
    const campaignId = Number(
      searchParams.get("campaignId") ?? getStreakCampaignIdForChain(chainId)
    );

    if (!isArcadeXRewardsConfiguredForChain(chainId)) {
      return NextResponse.json(
        { error: "Streak rewards are not configured yet.", configured: false },
        { status: 503 }
      );
    }

    if (!rawWallet || !isWalletAddress(rawWallet)) {
      return NextResponse.json(
        { error: "A valid walletAddress is required." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(campaignId) || campaignId < 1) {
      return NextResponse.json(
        { error: "Invalid campaignId." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(chainId)) {
      return NextResponse.json(
        { error: "Invalid chainId." },
        { status: 400 }
      );
    }

    const wallet = normalizeWalletAddress(rawWallet);
    const fresh = searchParams.get("fresh") === "1";
    const status = await getStreakProgressCached(wallet, campaignId, {
      fresh,
      chainId,
    });
    const maxAgeSec = fresh ? 0 : Math.floor(STREAK_PROGRESS_CACHE_MS / 1000);

    return NextResponse.json(
      { configured: true, chainId, ...status },
      {
        headers: {
          "Cache-Control": fresh
            ? "private, no-store"
            : `private, max-age=${maxAgeSec}`,
        },
      }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load streak status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
