import { NextResponse } from "next/server";
import { bootstrapUserOnServer } from "@/lib/rtdb-server";
import { buildPlayerId, WalletEcosystem } from "@/lib/player-identity";
import { isValidAddress } from "@/lib/player-identity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      walletAddress?: string;
      playerId?: string;
      ecosystem?: WalletEcosystem;
      chainId?: number;
    };

    const ecosystem = body.ecosystem;
    const rawWallet = body.walletAddress?.trim() ?? "";
    const explicitPlayerId = body.playerId?.trim() ?? "";

    let playerId = explicitPlayerId;
    if (!playerId && ecosystem && rawWallet) {
      if (!isValidAddress(ecosystem, rawWallet)) {
        return NextResponse.json(
          { error: "Invalid wallet address." },
          { status: 400 }
        );
      }
      playerId = buildPlayerId(ecosystem, rawWallet);
    }

    if (!playerId) {
      return NextResponse.json(
        { error: "playerId or walletAddress with ecosystem is required." },
        { status: 400 }
      );
    }

    const user = await bootstrapUserOnServer(playerId, {
      ecosystem,
      chainId: body.chainId,
    });
    return NextResponse.json({ user });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to bootstrap user.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
