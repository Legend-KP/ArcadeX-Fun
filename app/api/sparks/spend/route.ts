import { NextResponse } from "next/server";
import { NoSparksError, spendSparkOnServer } from "@/lib/rtdb-server";
import {
  buildPlayerId,
  isValidAddress,
  resolvePlayerId,
  WalletEcosystem,
} from "@/lib/player-identity";
import { readSessionFromCookies } from "@/lib/auth-session";

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
    };
    const session = await readSessionFromCookies();

    const playerId = resolvePlayerIdFromBody(body);

    if (!playerId) {
      return NextResponse.json(
        {
          error: "A valid playerId or walletAddress is required.",
          code: "NO_WALLET",
        },
        { status: 400 }
      );
    }

    const result = await spendSparkOnServer(playerId, Date.now(), {
      chainId:
        typeof body.chainId === "number" ? body.chainId : session?.chainId,
      ecosystem: body.ecosystem ?? session?.ecosystem,
    });
    return NextResponse.json(result);
  } catch (err) {
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
