import { NEYNAR_API_BASE } from "@/lib/farcaster/constants";

export type NeynarUser = {
  fid: number;
  username?: string;
  display_name?: string;
  pfp_url?: string;
  custody_address?: string;
  verified_addresses?: {
    eth_addresses?: string[];
    sol_addresses?: string[];
  };
};

function getNeynarApiKey(): string {
  const key = process.env.NEYNAR_API_KEY?.trim();
  if (!key) {
    throw new Error("NEYNAR_API_KEY is not configured.");
  }
  return key;
}

function getNeynarWalletId(): string {
  const id = process.env.NEYNAR_WALLET_ID?.trim();
  if (!id) {
    throw new Error("NEYNAR_WALLET_ID is not configured.");
  }
  return id;
}

async function neynarFetch<T>(
  path: string,
  init?: RequestInit & { walletId?: boolean }
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-api-key", getNeynarApiKey());
  headers.set("Accept", "application/json");
  if (init?.walletId) {
    headers.set("x-wallet-id", getNeynarWalletId());
  }
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${NEYNAR_API_BASE}${path}`, {
    ...init,
    headers,
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: text };
  }

  if (!res.ok) {
    const message =
      typeof json === "object" &&
      json &&
      "message" in json &&
      typeof (json as { message: unknown }).message === "string"
        ? (json as { message: string }).message
        : `Neynar request failed (${res.status})`;
    throw new Error(message);
  }

  return json as T;
}

export async function fetchNeynarUserByFid(
  fid: number
): Promise<NeynarUser | null> {
  if (!Number.isFinite(fid) || fid <= 0) return null;
  const data = await neynarFetch<{ users?: NeynarUser[] }>(
    `/farcaster/user/bulk?fids=${fid}`
  );
  return data.users?.[0] ?? null;
}

export async function fetchNeynarUserByCustodyAddress(
  address: string
): Promise<NeynarUser | null> {
  const normalized = address.trim().toLowerCase();
  if (!normalized.startsWith("0x")) return null;
  const data = await neynarFetch<{ user?: NeynarUser }>(
    `/farcaster/user/by_custody_address?custody_address=${encodeURIComponent(normalized)}`
  );
  return data.user ?? null;
}

/**
 * Reserve an FID from Neynar's shelf (sponsored by ArcadeX app wallet).
 * Must call register within ~10 minutes with the same wallet id.
 */
export async function fetchSponsoredFid(): Promise<number> {
  const data = await neynarFetch<{ fid: number }>("/farcaster/user/fid", {
    method: "GET",
    walletId: true,
  });
  if (!data.fid || !Number.isFinite(data.fid)) {
    throw new Error("Neynar did not return a FID.");
  }
  return data.fid;
}

export type RegisterSponsoredAccountInput = {
  fid: number;
  signature: string;
  requestedUserCustodyAddress: string;
  deadline: number;
  fname?: string;
  metadata?: {
    bio?: string;
    display_name?: string;
    pfp_url?: string;
    url?: string;
    username?: string;
  };
};

/**
 * Sponsored registration: ArcadeX's Neynar wallet pays gas + storage.
 * Never send ETH to the user's custody address.
 */
export async function registerSponsoredAccount(
  input: RegisterSponsoredAccountInput
): Promise<unknown> {
  return neynarFetch("/farcaster/user", {
    method: "POST",
    walletId: true,
    body: JSON.stringify({
      fid: input.fid,
      signature: input.signature,
      requested_user_custody_address: input.requestedUserCustodyAddress,
      deadline: input.deadline,
      ...(input.fname ? { fname: input.fname } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }),
  });
}
