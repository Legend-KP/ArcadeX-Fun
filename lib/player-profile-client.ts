import { PlayerProfile } from "@/types";
import { encodeUserId } from "@/lib/wallet-address";
import { setCachedPlayerName } from "@/lib/player-id";
import { WalletEcosystem } from "@/lib/player-identity";

export async function fetchPlayerProfile(
  playerId: string
): Promise<PlayerProfile | null> {
  const res = await fetch(`/api/users/${encodeUserId(playerId)}`, {
    cache: "no-store",
  });
  const data = (await res.json()) as { user?: PlayerProfile | null; error?: string };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not load player profile.");
  }

  const user = data.user ?? null;
  if (user?.name) setCachedPlayerName(user.name);
  return user;
}

export async function savePlayerProfile(
  playerId: string,
  name: string,
  opts?: {
    email?: string;
    walletAddress?: string;
    ecosystem?: WalletEcosystem;
    chainId?: number;
  }
): Promise<PlayerProfile> {
  const res = await fetch(`/api/users/${encodeUserId(playerId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      email: opts?.email,
      walletAddress: opts?.walletAddress,
      ecosystem: opts?.ecosystem,
      chainId: opts?.chainId,
    }),
  });

  const text = await res.text();
  let data: { user?: PlayerProfile; error?: string };
  try {
    data = JSON.parse(text) as { user?: PlayerProfile; error?: string };
  } catch {
    throw new Error(
      res.ok
        ? "Could not save player profile."
        : `Could not save player profile (${res.status}).`
    );
  }

  if (!res.ok || !data.user) {
    throw new Error(data.error ?? "Could not save player profile.");
  }

  setCachedPlayerName(data.user.name);
  return data.user;
}

export async function bootstrapPlayerProfile(
  playerId: string,
  opts?: { ecosystem?: WalletEcosystem; chainId?: number; walletAddress?: string }
): Promise<PlayerProfile> {
  const res = await fetch("/api/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId,
      walletAddress: opts?.walletAddress,
      ecosystem: opts?.ecosystem,
      chainId: opts?.chainId,
    }),
  });

  const data = (await res.json()) as { user?: PlayerProfile; error?: string };

  if (!res.ok || !data.user) {
    throw new Error(data.error ?? "Could not bootstrap player profile.");
  }

  if (data.user.name) setCachedPlayerName(data.user.name);
  return data.user;
}

export async function fetchAuthSession(): Promise<{
  playerId: string;
  address: string;
  ecosystem: WalletEcosystem;
  chainId?: number;
} | null> {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  const data = (await res.json()) as {
    session?: {
      playerId: string;
      address: string;
      ecosystem: WalletEcosystem;
      chainId?: number;
    } | null;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error ?? "Could not read auth session.");
  }

  return data.session ?? null;
}

export async function logoutSession(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
