import {
  buildPlayerId,
  isEvmAddress,
  normalizeEvmAddress,
  parsePlayerId,
  WalletEcosystem,
} from "@/lib/player-identity";
import { isWalletEcosystem } from "@/lib/wallet-ecosystems";

const PLAYER_ID_KEY = "arcadex_player_id";
const PLAYER_NAME_KEY = "arcadex_player_name";
const WALLET_KEY = "arcadex_wallet_address";
const ECOSYSTEM_KEY = "arcadex_ecosystem";
const WALLET_CONNECTOR_KEY = "arcadex_wallet_connector";

export function clearInvalidCachedWallet(): void {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem(WALLET_KEY);
  const ecosystem = localStorage.getItem(ECOSYSTEM_KEY) as WalletEcosystem | null;
  if (!raw || !ecosystem) {
    localStorage.removeItem(WALLET_KEY);
    return;
  }
  try {
    buildPlayerId(ecosystem, raw);
  } catch {
    localStorage.removeItem(WALLET_KEY);
    localStorage.removeItem(ECOSYSTEM_KEY);
    localStorage.removeItem(PLAYER_ID_KEY);
  }
}

export function clearStaleGuestId(): void {
  if (typeof window === "undefined") return;
  const id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) return;
  if (!parsePlayerId(id) && !isEvmAddress(id)) {
    localStorage.removeItem(PLAYER_ID_KEY);
  }
}

export function getCachedEcosystem(): WalletEcosystem | null {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem(ECOSYSTEM_KEY);
  return value && isWalletEcosystem(value) ? value : null;
}

export function getCachedWallet(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WALLET_KEY);
}

export function getCachedPlayerId(): string | null {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) return null;
  if (parsePlayerId(id)) return id;
  if (isEvmAddress(id)) return buildPlayerId("evm", id);
  return null;
}

export function setCachedSession(
  ecosystem: WalletEcosystem,
  address: string,
  playerId: string,
  connectorId?: string | null
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ECOSYSTEM_KEY, ecosystem);
  localStorage.setItem(WALLET_KEY, address);
  localStorage.setItem(PLAYER_ID_KEY, playerId);
  if (connectorId) {
    localStorage.setItem(WALLET_CONNECTOR_KEY, connectorId);
  }
}

export function getCachedWalletConnectorId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(WALLET_CONNECTOR_KEY);
}

export function setCachedWalletConnectorId(connectorId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(WALLET_CONNECTOR_KEY, connectorId);
}

export function clearCachedSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ECOSYSTEM_KEY);
  localStorage.removeItem(WALLET_KEY);
  localStorage.removeItem(PLAYER_ID_KEY);
  localStorage.removeItem(PLAYER_NAME_KEY);
  localStorage.removeItem(WALLET_CONNECTOR_KEY);
}

/** @deprecated Use setCachedSession */
export function setCachedWallet(address: string): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeEvmAddress(address);
  localStorage.setItem(WALLET_KEY, normalized);
  localStorage.setItem(PLAYER_ID_KEY, buildPlayerId("evm", normalized));
  localStorage.setItem(ECOSYSTEM_KEY, "evm");
}

export function getCachedPlayerName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PLAYER_NAME_KEY);
}

export function setCachedPlayerName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PLAYER_NAME_KEY, name);
}

export function clearCachedPlayerName(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PLAYER_NAME_KEY);
}
