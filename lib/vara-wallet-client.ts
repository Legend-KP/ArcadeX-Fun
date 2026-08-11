"use client";

import {
  web3Accounts,
  web3Enable,
  web3FromAddress,
  isWeb3Injected,
} from "@polkadot/extension-dapp";
import { stringToU8a, u8aToHex } from "@polkadot/util";
import { buildPlainAuthMessage } from "@/lib/plain-auth";
import {
  ensureVaraCryptoReady,
  isLikelyEvmAddress,
  isVaraWalletAddress,
} from "@/lib/vara-address";

const VARA_APP_NAME = "ArcadeX";
const SUBWALLET_INJECTED_KEY = "subwallet-js";

let cryptoWarmed = false;
/** Only cache a successful enable — empty results must be retryable (esp. mobile). */
let extensionsEnabled = false;

function hasInjectedSubWallet(): boolean {
  if (typeof window === "undefined") return false;
  const injected = (
    window as Window & {
      injectedWeb3?: Record<string, unknown>;
    }
  ).injectedWeb3;
  return Boolean(injected?.[SUBWALLET_INJECTED_KEY] || isWeb3Injected);
}

function isLikelyMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Warm WASM only — never call web3Enable here (needs a user gesture on mobile). */
export function warmVaraWallet(): void {
  if (cryptoWarmed) return;
  cryptoWarmed = true;
  void ensureVaraCryptoReady().catch(() => {
    cryptoWarmed = false;
  });
}

async function waitForSubWalletInjection(timeoutMs = 2500): Promise<boolean> {
  if (hasInjectedSubWallet()) return true;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("subwallet#initialized", onReady);
      resolve(ok);
    };

    const onReady = () => finish(hasInjectedSubWallet());
    const timer = window.setTimeout(
      () => finish(hasInjectedSubWallet()),
      timeoutMs
    );
    window.addEventListener("subwallet#initialized", onReady, { once: true });
  });
}

async function ensureVaraExtensions(): Promise<boolean> {
  await ensureVaraCryptoReady();

  if (extensionsEnabled) return true;

  await waitForSubWalletInjection();

  if (!hasInjectedSubWallet()) {
    return false;
  }

  const extensions = await web3Enable(VARA_APP_NAME);
  extensionsEnabled = extensions.length > 0;
  return extensionsEnabled;
}

function missingWalletMessage(): string {
  if (isLikelyMobile()) {
    return "SubWallet not detected. On mobile, open ArcadeX inside the SubWallet app browser (Browser tab → paste arcadex.fun), then connect Vara again.";
  }
  return "SubWallet / Polkadot.js not found. Install SubWallet and create a Vara (Substrate) account.";
}

export async function connectVaraWallet(): Promise<string> {
  const ready = await ensureVaraExtensions();
  if (!ready) {
    throw new Error(missingWalletMessage());
  }

  const accounts = await web3Accounts();
  const substrateAccounts = accounts.filter((account) => {
    if (account.type === "ethereum") return false;
    if (isLikelyEvmAddress(account.address)) return false;
    return isVaraWalletAddress(account.address);
  });

  const account = substrateAccounts[0] ?? accounts[0];
  if (!account) {
    throw new Error(
      "No Vara account found. In SubWallet, select a Substrate/Vara account (not EVM)."
    );
  }

  if (
    account.type === "ethereum" ||
    isLikelyEvmAddress(account.address) ||
    !isVaraWalletAddress(account.address)
  ) {
    throw new Error(
      "SubWallet returned an EVM account. Switch to a Vara / Substrate account, then reconnect."
    );
  }

  // Keep the extension's SS58 as-is so SubWallet can sign for this account.
  // Server-side normalizeVaraAddress re-encodes to Vara prefix when possible.
  return account.address;
}

export async function signVaraMessage(
  address: string,
  nonce: string
): Promise<{ address: string; signature: string; message: string }> {
  const ready = await ensureVaraExtensions();
  if (!ready) {
    throw new Error(missingWalletMessage());
  }

  const injector = await web3FromAddress(address);
  if (!injector.signer.signRaw) {
    throw new Error("Selected account cannot sign messages.");
  }

  const message = buildPlainAuthMessage(nonce);
  const { signature } = await injector.signer.signRaw({
    address,
    data: u8aToHex(stringToU8a(message)),
    type: "bytes",
  });

  return { address, signature, message };
}
