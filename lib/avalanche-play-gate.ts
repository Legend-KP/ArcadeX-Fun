/**
 * Avalanche off-chain play gate (Option B).
 * Signed intent required before spark spend when no TxHub contract exists.
 */
import { avalanche } from "@/lib/chains";
import { normalizeEvmAddress } from "@/lib/player-identity";

export const AVALANCHE_PLAY_GATE_CHAIN_ID = avalanche.id;
export const AVALANCHE_PLAY_GATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function shouldRequireAvalanchePlayGate(opts: {
  ecosystem?: string | null;
  chainId?: number | null;
}): boolean {
  if (opts.ecosystem && opts.ecosystem !== "evm") return false;
  if (
    typeof opts.chainId === "number" &&
    Number.isFinite(opts.chainId) &&
    opts.chainId === AVALANCHE_PLAY_GATE_CHAIN_ID
  ) {
    return true;
  }
  return false;
}

export function buildAvalanchePlayGateMessage(params: {
  gameId: string;
  address: string;
  chainId: number;
  issuedAt: number;
  expiresAt: number;
}): string {
  const address = normalizeEvmAddress(params.address);
  return [
    "ArcadeX Play Intent",
    `Game: ${params.gameId.trim()}`,
    `Purpose: PLAY:${params.gameId.trim()}`,
    `Address: ${address}`,
    `Chain ID: ${params.chainId}`,
    `Issued At: ${params.issuedAt}`,
    `Expires At: ${params.expiresAt}`,
  ].join("\n");
}

export function parseAvalanchePlayGateMessage(message: string): {
  gameId: string;
  address: string;
  chainId: number;
  issuedAt: number;
  expiresAt: number;
} | null {
  const lines = message.trim().split(/\r?\n/);
  if (lines[0]?.trim() !== "ArcadeX Play Intent") return null;

  const map = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }

  const gameId = map.get("Game") ?? "";
  const purpose = map.get("Purpose") ?? "";
  const address = map.get("Address") ?? "";
  const chainId = Number(map.get("Chain ID"));
  const issuedAt = Number(map.get("Issued At"));
  const expiresAt = Number(map.get("Expires At"));

  if (!gameId || purpose !== `PLAY:${gameId}`) return null;
  if (!address || !Number.isFinite(chainId)) return null;
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;

  return { gameId, address, chainId, issuedAt, expiresAt };
}
