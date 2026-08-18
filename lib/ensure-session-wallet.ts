"use client";

import { reconnectPetraWallet } from "@/lib/aptos-wallet-client";
import { ensureEvmWagmiConnected } from "@/lib/ensure-evm-wallet";
import {
  isWalletSessionMismatchError,
  WalletSessionMismatchError,
} from "@/lib/evm-session-wallet";
import { reconnectMovementWallet } from "@/lib/movement-wallet-client";
import {
  sessionAddressesEqual,
  type WalletEcosystem,
} from "@/lib/player-identity";
import { reconnectStarknetWallet } from "@/lib/starknet-wallet-client";
import { reconnectFreighterWallet } from "@/lib/stellar-wallet-client";
import { reconnectSlushWallet } from "@/lib/sui-wallet-client";
import { resolveVaraSigningAddress } from "@/lib/vara-tx-hub-client";

export type EnsureSessionWalletResult =
  | { ok: true; address: string }
  | {
      ok: false;
      reason: "unavailable" | "mismatch";
      message?: string;
    };

function mismatchResult(
  activeAddress: string,
  expectedAddress: string
): EnsureSessionWalletResult {
  return {
    ok: false,
    reason: "mismatch",
    message: new WalletSessionMismatchError(activeAddress, expectedAddress)
      .message,
  };
}

/**
 * Restore a live extension connection for an already-authenticated session.
 * Silent (`allowPrompt: false`) never opens a wallet popup — used on cold start.
 * Prompted restore is for user gestures (daily check-in, start game, pay).
 */
export async function ensureSessionWalletReady(opts: {
  ecosystem: WalletEcosystem;
  expectedAddress: string;
  allowPrompt?: boolean;
}): Promise<EnsureSessionWalletResult> {
  const allowPrompt = opts.allowPrompt !== false;
  const expected = opts.expectedAddress.trim();

  try {
    switch (opts.ecosystem) {
      case "evm": {
        const result = await ensureEvmWagmiConnected({
          expectedAddress: expected,
          allowPrompt,
        });
        if (result.ok) return { ok: true, address: result.address };
        return {
          ok: false,
          reason: result.reason,
          message: result.error?.message,
        };
      }
      case "vara": {
        if (!allowPrompt) {
          return { ok: false, reason: "unavailable" };
        }
        const address = await resolveVaraSigningAddress(expected);
        return { ok: true, address };
      }
      case "sui": {
        const { account } = await reconnectSlushWallet({ allowPrompt });
        if (!sessionAddressesEqual("sui", account.address, expected)) {
          return mismatchResult(account.address, expected);
        }
        return { ok: true, address: account.address };
      }
      case "aptos": {
        const account = await reconnectPetraWallet({ allowPrompt });
        if (!sessionAddressesEqual("aptos", account.address, expected)) {
          return mismatchResult(account.address, expected);
        }
        return { ok: true, address: account.address };
      }
      case "movement": {
        const account = await reconnectMovementWallet({ allowPrompt });
        if (!sessionAddressesEqual("movement", account.address, expected)) {
          return mismatchResult(account.address, expected);
        }
        return { ok: true, address: account.address };
      }
      case "stellar": {
        const address = await reconnectFreighterWallet({ allowPrompt });
        if (!sessionAddressesEqual("stellar", address, expected)) {
          return mismatchResult(address, expected);
        }
        return { ok: true, address };
      }
      case "starknet": {
        const address = await reconnectStarknetWallet({ allowPrompt });
        if (!sessionAddressesEqual("starknet", address, expected)) {
          return mismatchResult(address, expected);
        }
        return { ok: true, address };
      }
    }
  } catch (err) {
    if (isWalletSessionMismatchError(err)) {
      return {
        ok: false,
        reason: "mismatch",
        message: err.message,
      };
    }
    return {
      ok: false,
      reason: "unavailable",
      message: err instanceof Error ? err.message : undefined,
    };
  }
}
