"use client";

import { connect as connectStarknet } from "starknetkit";
import { InjectedConnector } from "starknetkit/injected";
import { getCachedWalletConnectorId } from "@/lib/player-id";

const STARKNET_WALLETS = [
  { id: "braavos" as const, name: "Braavos" },
  { id: "argentX" as const, name: "Ready Wallet" },
];

function walletPreferenceScore(id: string, cached: string): number {
  if (!cached) return 0;
  const lower = id.toLowerCase();
  if (lower === cached || cached.includes(lower)) return 3;
  if (cached.includes("braavos") && lower === "braavos") return 3;
  if (
    (cached.includes("argent") || cached.includes("ready")) &&
    lower === "argentx"
  ) {
    return 3;
  }
  return 0;
}

export async function reconnectStarknetWallet(opts?: {
  allowPrompt?: boolean;
}): Promise<string> {
  const allowPrompt = opts?.allowPrompt !== false;
  const cached = getCachedWalletConnectorId()?.toLowerCase() ?? "";
  const ordered = [...STARKNET_WALLETS].sort(
    (a, b) =>
      walletPreferenceScore(b.id, cached) - walletPreferenceScore(a.id, cached)
  );

  for (const wallet of ordered) {
    try {
      const { connectorData } = await connectStarknet({
        modalMode: "neverAsk",
        connectors: [
          new InjectedConnector({
            options: { id: wallet.id, name: wallet.name },
          }),
        ],
      });
      if (connectorData?.account) return connectorData.account;
    } catch {
      // Try the next injected wallet.
    }
  }

  if (!allowPrompt) {
    throw new Error("Starknet wallet is not connected to this site.");
  }

  throw new Error(
    "Reconnect your Starknet wallet, then try again."
  );
}
