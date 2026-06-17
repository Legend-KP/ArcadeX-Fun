import { NextResponse } from "next/server";
import { fetchUserFromServer, upsertUserOnServer } from "@/lib/rtdb-server";
import { resolvePlayerId } from "@/lib/player-identity";
import { WalletEcosystem } from "@/lib/player-identity";

export const dynamic = "force-dynamic";

const NAME_RE = /^[\w\s.-]{1,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id.trim()) {
      return NextResponse.json({ error: "User id required." }, { status: 400 });
    }

    const playerId = resolvePlayerId(decodeURIComponent(id));
    if (!playerId) {
      return NextResponse.json({ user: null });
    }

    const user = await fetchUserFromServer(playerId);
    return NextResponse.json({ user: user ?? null });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load player profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id.trim()) {
      return NextResponse.json({ error: "User id required." }, { status: 400 });
    }

    const playerId = resolvePlayerId(decodeURIComponent(id));
    if (!playerId) {
      return NextResponse.json(
        { error: "Invalid player id." },
        { status: 400 }
      );
    }

    const body = (await request.json()) as {
      name?: string;
      email?: string;
      walletAddress?: string;
      ecosystem?: WalletEcosystem;
      chainId?: number;
    };

    const name = body.name?.trim() ?? "";
    if (!NAME_RE.test(name)) {
      return NextResponse.json(
        { error: "Name must be 1–20 characters (letters, numbers, spaces)." },
        { status: 400 }
      );
    }

    const email = body.email?.trim();
    if (email && !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    const user = await upsertUserOnServer(playerId, {
      name,
      email: email || undefined,
      walletAddress: body.walletAddress,
      ecosystem: body.ecosystem,
      chainId: body.chainId,
    });

    return NextResponse.json({ user });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save player profile.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
