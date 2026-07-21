import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  fetchUserFromServer,
  submitPublicScoreOnServer,
  ShopPurchaseError,
} from "@/lib/rtdb-server";
import {
  corsJsonResponse,
  handleCorsPreflightRequest,
} from "@/lib/cors";
import {
  gameHasContestLive,
  gameHasLeaderboard,
  LeaderboardEntry,
} from "@/types";
import { isWalletAddress, tryNormalizeWalletAddress } from "@/lib/wallet-address";
import { verifyScoreSubmitPayment } from "@/lib/score-submit-server";
import { parsePlayerId, resolvePlayerId } from "@/lib/player-identity";
import type { WalletEcosystem } from "@/lib/player-identity";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

function resolveEcosystem(body: {
  ecosystem?: WalletEcosystem;
  walletAddress?: string;
}): WalletEcosystem {
  if (body.ecosystem) return body.ecosystem;
  const playerId = resolvePlayerId(body.walletAddress ?? "");
  const parsed = playerId ? parsePlayerId(playerId) : null;
  return parsed?.ecosystem ?? "evm";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const game = await fetchGameFromServer(id);
    if (!game || !gameHasLeaderboard(game)) {
      return corsJsonResponse(
        request,
        { error: "Leaderboard is not enabled for this game." },
        { status: 404 }
      );
    }

    const body = (await request.json()) as LeaderboardEntry & {
      txHash?: string;
      tokenAddress?: string;
      ecosystem?: WalletEcosystem;
      playerName?: string;
    };

    const score = body.score;
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0) {
      return corsJsonResponse(
        request,
        { error: "score is required." },
        { status: 400 }
      );
    }

    const txHash = body.txHash?.trim();
    if (!txHash) {
      return corsJsonResponse(
        request,
        { error: "txHash is required." },
        { status: 400 }
      );
    }

    const wallet = tryNormalizeWalletAddress(body.walletAddress);
    if (!wallet || !isWalletAddress(wallet)) {
      return corsJsonResponse(
        request,
        { error: "walletAddress is required." },
        { status: 400 }
      );
    }

    let name = body.name?.trim() || body.playerName?.trim() || "";
    if (!name) {
      const profile = await fetchUserFromServer(wallet);
      name = profile?.name?.trim() || "";
    }
    if (!name) {
      name = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    }

    const ecosystem = resolveEcosystem(body);

    await verifyScoreSubmitPayment({
      ecosystem,
      txHash,
      tokenAddress: body.tokenAddress,
      expectedFrom: wallet,
    });

    const contestStartedAt =
      gameHasContestLive(game) && typeof game.contestStartedAt === "number"
        ? game.contestStartedAt
        : undefined;

    const entry: LeaderboardEntry = {
      name,
      score,
      walletAddress: wallet,
    };

    const { submittedBest } = await submitPublicScoreOnServer({
      gameId: id,
      entry,
      txHash,
      ecosystem:
        ecosystem === "evm" || ecosystem === "sui" || ecosystem === "vara"
          ? ecosystem
          : "evm",
      contestStartedAt,
    });

    return corsJsonResponse(request, {
      success: true,
      submittedBest,
      score,
    });
  } catch (err) {
    if (err instanceof ShopPurchaseError) {
      return corsJsonResponse(
        request,
        { error: err.message, code: err.code },
        { status: 400 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to submit score.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
