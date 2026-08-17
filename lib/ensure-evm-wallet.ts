"use client";

import {
  connect,
  disconnect,
  getConnection,
  getConnectors,
  reconnect,
} from "@wagmi/core";
import { getAddress, type Address } from "viem";
import { wagmiConfig } from "@/lib/wagmi-config";
import { getCachedWalletConnectorId } from "@/lib/player-id";
import { WalletSessionMismatchError } from "@/lib/evm-session-wallet";

function addressesMatch(a: string, b: string): boolean {
  try {
    return getAddress(a) === getAddress(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

function connectorPreferenceScore(connector: {
  id: string;
  name: string;
}): number {
  const cached = getCachedWalletConnectorId()?.toLowerCase() ?? "";
  if (!cached) return 0;
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  if (id === cached || name === cached) return 3;
  if (id.includes(cached) || cached.includes(id) || name.includes(cached)) {
    return 2;
  }
  if (cached.includes("metamask") && (id.includes("meta") || name.includes("meta"))) {
    return 2;
  }
  if (
    cached.includes("coinbase") &&
    (id.includes("coinbase") || name.includes("coinbase"))
  ) {
    return 2;
  }
  return 0;
}

function orderedConnectors() {
  return [...getConnectors(wagmiConfig)].sort(
    (a, b) => connectorPreferenceScore(b) - connectorPreferenceScore(a)
  );
}

function isWalletConnectConnector(connector: { id: string; name: string }) {
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  return id.includes("walletconnect") || name.includes("walletconnect");
}

export type EnsureEvmWalletResult =
  | { ok: true; address: Address }
  | {
      ok: false;
      reason: "unavailable" | "mismatch";
      activeAddress?: string;
      error?: WalletSessionMismatchError;
    };

/**
 * Restore a live wagmi connection for an already-authenticated EVM session.
 * Prefer silent `reconnect` (storage); optionally `connect` under a user gesture.
 */
export async function ensureEvmWagmiConnected(opts?: {
  expectedAddress?: string | null;
  /** When false, only restore from wagmi storage — never open a wallet prompt. */
  allowPrompt?: boolean;
}): Promise<EnsureEvmWalletResult> {
  const expected = opts?.expectedAddress?.trim() || null;
  const allowPrompt = opts?.allowPrompt !== false;

  let connection = getConnection(wagmiConfig);
  if (connection.address && connection.isConnected) {
    if (!expected || addressesMatch(connection.address, expected)) {
      return { ok: true, address: getAddress(connection.address) };
    }
    return {
      ok: false,
      reason: "mismatch",
      activeAddress: connection.address,
      error: new WalletSessionMismatchError(connection.address, expected),
    };
  }

  try {
    await reconnect(wagmiConfig);
  } catch {
    // Storage empty / connectors unavailable — try explicit connect below.
  }

  connection = getConnection(wagmiConfig);
  if (connection.address && connection.isConnected) {
    if (!expected || addressesMatch(connection.address, expected)) {
      return { ok: true, address: getAddress(connection.address) };
    }
    return {
      ok: false,
      reason: "mismatch",
      activeAddress: connection.address,
      error: new WalletSessionMismatchError(connection.address, expected),
    };
  }

  if (!allowPrompt) {
    return { ok: false, reason: "unavailable" };
  }

  const cached = getCachedWalletConnectorId()?.toLowerCase() ?? "";
  for (const connector of orderedConnectors()) {
    if (
      isWalletConnectConnector(connector) &&
      !cached.includes("walletconnect")
    ) {
      continue;
    }

    try {
      const result = await connect(wagmiConfig, { connector });
      const address = result.accounts[0];
      if (!address) continue;

      if (expected && !addressesMatch(address, expected)) {
        await disconnect(wagmiConfig).catch(() => undefined);
        return {
          ok: false,
          reason: "mismatch",
          activeAddress: address,
          error: new WalletSessionMismatchError(address, expected),
        };
      }

      return { ok: true, address: getAddress(address) };
    } catch {
      // Only the preferred connector should prompt. Stop after first failure
      // so we don't open Coinbase/WalletConnect after MetaMask times out.
      break;
    }
  }

  return { ok: false, reason: "unavailable" };
}
