import { fetchGameFromServer } from "@/lib/firestore-server";
import {
  fetchUserFromServer,
  claimScoreSubmitTxOnServer,
  confirmScoreSubmitTxOnServer,
  releaseScoreSubmitTxClaimOnServer,
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
import { verifyScoreSubmitPayment } from "@/lib/score-submit-server";
import {
  isValidAddress,
  normalizeAddress,
  type WalletEcosystem,
} from "@/lib/player-identity";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import {
  applyContestForChain,
  resolveContestChainKey,
} from "@/lib/contest-chains";
import {
  evaluateScoreAnomaly,
  shouldEnforceScoreBounds,
} from "@/lib/play-session";
import {
  assertPlaySessionActive,
  consumePlaySessionOnServer,
  flagAnomalousScoreOnServer,
  PlaySessionError,
} from "@/lib/play-session-server";
import { isPaymentStillConfirmingError } from "@/lib/payment-tx-verify";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflightRequest(request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ip = getClientIp(request);
    if (
      !(await checkRateLimit(`score-submit:ip:${ip}`, 30, 60_000)) ||
      !(await checkRateLimit(`score-submit:game:${id}:${ip}`, 15, 60_000))
    ) {
      return rateLimitResponse();
    }

    if (!id || id.length > 128 || /[.#$[\]/]/.test(id)) {
      return corsJsonResponse(
        request,
        { error: "Invalid game id." },
        { status: 400 }
      );
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 32_768) {
      return corsJsonResponse(
        request,
        { error: "Request body too large." },
        { status: 413 }
      );
    }

    const session = await readSessionFromCookies();
    if (!session) {
      return corsJsonResponse(
        request,
        { error: "Sign in to submit a score.", code: "NO_SESSION" },
        { status: 401 }
      );
    }

    if (
      !(await checkRateLimit(
        `score-submit:player:${session.playerId}`,
        20,
        60_000
      ))
    ) {
      return rateLimitResponse();
    }

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
      chainId?: number;
      playSessionId?: string;
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

    const playSessionId = body.playSessionId?.trim() ?? "";
    if (!playSessionId) {
      return corsJsonResponse(
        request,
        {
          error: "playSessionId is required. Start the game again.",
          code: "NO_PLAY_SESSION",
        },
        { status: 400 }
      );
    }

    // Bind identity from authenticated session — never trust client wallet for verify.
    const ecosystem = session.ecosystem;
    const wallet = normalizeAddress(ecosystem, session.address);
    const chainId =
      typeof session.chainId === "number" && Number.isFinite(session.chainId)
        ? session.chainId
        : typeof body.chainId === "number" && Number.isFinite(body.chainId)
          ? body.chainId
          : undefined;

    // Optional sanity cross-check against client-supplied wallet.
    const rawWallet = body.walletAddress?.trim() ?? "";
    if (rawWallet && isValidAddress(ecosystem, rawWallet)) {
      const clientWallet = normalizeAddress(ecosystem, rawWallet);
      if (clientWallet !== wallet) {
        return corsJsonResponse(
          request,
          {
            error: "Wallet does not match your signed-in session.",
            code: "WALLET_MISMATCH",
          },
          { status: 403 }
        );
      }
    }

    const playSession = await assertPlaySessionActive({
      playSessionId,
      playerId: session.playerId,
      gameId: id,
      chainId,
      ecosystem,
    });

    const anomaly = evaluateScoreAnomaly({
      score,
      scoreBounds: game.scoreBounds,
      sessionStartedAt: playSession.startedAt,
    });
    if (anomaly.flagged) {
      await flagAnomalousScoreOnServer({
        gameId: id,
        playerId: session.playerId,
        score,
        playSessionId,
        reasons: anomaly.reasons,
        scoreBounds: game.scoreBounds,
        sessionStartedAt: playSession.startedAt,
        elapsedMs: Date.now() - playSession.startedAt,
        chainId,
        ecosystem,
        source: "leaderboard_submit",
      }).catch(() => {
        // Flagging is best-effort
      });

      if (shouldEnforceScoreBounds()) {
        return corsJsonResponse(
          request,
          {
            error: "Score failed integrity checks.",
            code: "SCORE_ANOMALY",
            reasons: anomaly.reasons,
          },
          { status: 400 }
        );
      }
    }

    let name = body.name?.trim() || body.playerName?.trim() || "";
    if (!name) {
      const profile = await fetchUserFromServer(wallet, {
        chainId,
        ecosystem,
      });
      name = profile?.name?.trim() || "";
    }
    if (!name) {
      name = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
    }

    const shopEcosystem =
      ecosystem === "evm" || ecosystem === "sui" || ecosystem === "vara"
        ? ecosystem
        : "evm";

    const contestChainKey = resolveContestChainKey({
      chainId,
      ecosystem,
    });
    const chainGame = applyContestForChain(game, contestChainKey);

    const claim = await claimScoreSubmitTxOnServer({
      txHash,
      gameId: id,
      walletAddress: wallet,
      playerId: session.playerId,
      ecosystem: shopEcosystem,
      chainId,
    });

    if (claim.outcome === "conflict") {
      return corsJsonResponse(
        request,
        {
          error: "This transaction was already used.",
          code: "TX_ALREADY_USED",
        },
        { status: 400 }
      );
    }

    if (claim.outcome !== "already_confirmed") {
      const canReleaseClaim = claim.outcome === "claimed";
      try {
        await verifyScoreSubmitPayment({
          ecosystem,
          txHash,
          tokenAddress: body.tokenAddress,
          expectedFrom: wallet,
          chainId,
        });
      } catch (err) {
        if (isPaymentStillConfirmingError(err)) {
          // Leave pending claim so concurrent retries serialize on the same hash.
          throw err;
        }
        if (canReleaseClaim) {
          await releaseScoreSubmitTxClaimOnServer({
            txHash,
            ecosystem: shopEcosystem,
            chainId,
            reason: err instanceof Error ? err.message : "verify_failed",
          });
        }
        throw err;
      }

      await confirmScoreSubmitTxOnServer({
        txHash,
        gameId: id,
        walletAddress: wallet,
        playerId: session.playerId,
        ecosystem: shopEcosystem,
        chainId,
      });
    }

    const contestStartedAt =
      gameHasContestLive(chainGame) &&
      typeof chainGame.contestStartedAt === "number"
        ? chainGame.contestStartedAt
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
      ecosystem: shopEcosystem,
      contestStartedAt,
      chainId,
      skipClaimWrite: true,
    });

    await consumePlaySessionOnServer({
      playSessionId,
      playerId: session.playerId,
      gameId: id,
      chainId,
      ecosystem,
    }).catch(() => {
      // Score already credited; consume is best-effort
    });

    return corsJsonResponse(request, {
      success: true,
      submittedBest,
      score,
    });
  } catch (err) {
    if (err instanceof PlaySessionError) {
      return corsJsonResponse(
        request,
        { error: err.message, code: err.code },
        { status: 400 }
      );
    }

    if (err instanceof ShopPurchaseError) {
      return corsJsonResponse(
        request,
        { error: err.message, code: err.code },
        { status: 400 }
      );
    }

    if (isPaymentStillConfirmingError(err)) {
      return corsJsonResponse(
        request,
        {
          error:
            err instanceof Error
              ? err.message
              : "Payment is still confirming.",
          code: "PAYMENT_CONFIRMING",
        },
        { status: 409 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to submit score.";
    return corsJsonResponse(request, { error: message }, { status: 500 });
  }
}
