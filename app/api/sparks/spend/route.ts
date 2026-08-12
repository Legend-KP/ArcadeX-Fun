import { NextResponse } from "next/server";
import { NoSparksError, spendSparkOnServer } from "@/lib/rtdb-server";
import {
  buildPlayerId,
  isValidAddress,
  normalizeAddress,
  resolvePlayerId,
  WalletEcosystem,
} from "@/lib/player-identity";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/rate-limit";
import { shouldRequireAvalanchePlayGate } from "@/lib/avalanche-play-gate";
import {
  AvalanchePlayGateError,
  verifyAndClaimAvalanchePlayGate,
} from "@/lib/avalanche-play-gate-server";
import { createPlaySessionOnServer } from "@/lib/play-session-server";

export const dynamic = "force-dynamic";

function resolvePlayerIdFromBody(body: {
  playerId?: string;
  walletAddress?: string;
  ecosystem?: WalletEcosystem;
}): string | null {
  const fromPlayerId = resolvePlayerId(body.playerId ?? "");
  if (fromPlayerId) return fromPlayerId;

  const wallet = body.walletAddress?.trim() ?? "";
  if (wallet && body.ecosystem && isValidAddress(body.ecosystem, wallet)) {
    return buildPlayerId(body.ecosystem, wallet);
  }

  return resolvePlayerId(wallet);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      playerId?: string;
      walletAddress?: string;
      ecosystem?: WalletEcosystem;
      chainId?: number;
      gameId?: string;
      playGate?: { message?: string; signature?: string };
    };

    const session = await readSessionFromCookies();
    if (!session) {
      return NextResponse.json(
        { error: "Sign in to spend a Spark.", code: "NO_SESSION" },
        { status: 401 }
      );
    }

    const ip = getClientIp(request);
    if (
      !(await checkRateLimit(
        `sparks-spend:player:${session.playerId}`,
        10,
        60_000
      )) ||
      !(await checkRateLimit(`sparks-spend:ip:${ip}`, 30, 60_000))
    ) {
      return rateLimitResponse();
    }

    const bodyPlayerId = resolvePlayerIdFromBody(body);
    if (bodyPlayerId && bodyPlayerId !== session.playerId) {
      return NextResponse.json(
        {
          error: "Player does not match your signed-in session.",
          code: "PLAYER_MISMATCH",
        },
        { status: 403 }
      );
    }

    const playerId = session.playerId;
    const ecosystem = session.ecosystem;
    const chainId =
      typeof session.chainId === "number"
        ? session.chainId
        : typeof body.chainId === "number"
          ? body.chainId
          : undefined;
    const gameId = body.gameId?.trim() ?? "";

    if (!gameId || gameId.length > 128 || /[.#$[\]/]/.test(gameId)) {
      return NextResponse.json(
        { error: "gameId is required to start a play session.", code: "INVALID_GAME" },
        { status: 400 }
      );
    }

    if (shouldRequireAvalanchePlayGate({ ecosystem, chainId })) {
      const message = body.playGate?.message?.trim() ?? "";
      const signature = body.playGate?.signature?.trim() ?? "";
      if (!message || !signature) {
        return NextResponse.json(
          {
            error: "Avalanche play intent signature is required.",
            code: "PLAY_GATE_REQUIRED",
          },
          { status: 400 }
        );
      }

      await verifyAndClaimAvalanchePlayGate({
        message,
        signature,
        expectedFrom: session.address,
        gameId,
        chainId,
      });
    }

    const result = await spendSparkOnServer(playerId, Date.now(), {
      chainId,
      ecosystem,
    });

    const walletAddress = normalizeAddress(ecosystem, session.address);
    const { playSessionId } = await createPlaySessionOnServer({
      playerId,
      gameId,
      walletAddress,
      chainId,
      ecosystem,
    });

    return NextResponse.json({ ...result, playSessionId });
  } catch (err) {
    if (err instanceof AvalanchePlayGateError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "ALREADY_USED" ? 409 : 400 }
      );
    }

    if (err instanceof NoSparksError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 402 }
      );
    }

    const message =
      err instanceof Error ? err.message : "Failed to spend Spark.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
