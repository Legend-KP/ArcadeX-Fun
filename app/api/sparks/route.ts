import { NextResponse } from "next/server";
import { getSparkSnapshotOnServer } from "@/lib/rtdb-server";
import {
  buildPlayerId,
  isValidAddress,
  resolvePlayerId,
  WalletEcosystem,
} from "@/lib/player-identity";
import { readSessionFromCookies } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

function resolvePlayerIdFromRequest(
  playerId?: string | null,
  walletAddress?: string | null,
  ecosystem?: WalletEcosystem | null
): string | null {
  const fromPlayerId = resolvePlayerId(playerId ?? "");
  if (fromPlayerId) return fromPlayerId;

  const wallet = walletAddress?.trim() ?? "";
  if (wallet && ecosystem && isValidAddress(ecosystem, wallet)) {
    return buildPlayerId(ecosystem, wallet);
  }

  return resolvePlayerId(wallet);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const session = await readSessionFromCookies();
    const ecosystem =
      (searchParams.get("ecosystem") as WalletEcosystem | null) ??
      session?.ecosystem ??
      null;
    const playerId = resolvePlayerIdFromRequest(
      searchParams.get("playerId"),
      searchParams.get("walletAddress"),
      ecosystem
    );

    if (!playerId) {
      return NextResponse.json(
        {
          error: "A valid playerId or walletAddress is required.",
          code: "NO_WALLET",
        },
        { status: 400 }
      );
    }

    const chainIdRaw = searchParams.get("chainId");
    const chainIdFromQuery =
      chainIdRaw != null && chainIdRaw !== "" ? Number(chainIdRaw) : undefined;
    const chainId =
      typeof chainIdFromQuery === "number" && Number.isFinite(chainIdFromQuery)
        ? chainIdFromQuery
        : session?.chainId;

    const result = await getSparkSnapshotOnServer(playerId, Date.now(), {
      chainId,
      ecosystem,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load Sparks.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
