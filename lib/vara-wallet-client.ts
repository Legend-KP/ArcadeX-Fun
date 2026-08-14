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
const INJECTED_READY_EVENTS = [
  "subwallet#initialized",
  "talisman#initialized",
] as const;

const INJECTED_WALLET_LABELS: Record<string, string> = {
  "subwallet-js": "SubWallet",
  "polkadot-js": "polkadot.js",
  talisman: "Talisman",
  "nova-wallet": "Nova",
  nova: "Nova",
  enkrypt: "Enkrypt",
  "fearless-wallet": "Fearless",
  polkagate: "PolkaGate",
};

let cryptoWarmed = false;
/** Only cache a successful enable — empty results must be retryable (esp. mobile). */
let extensionsEnabled = false;

/** Friendly name for status copy, e.g. "polkadot.js" or "your wallet". */
export function varaWalletLabel(injectedName?: string | null): string {
  if (!injectedName) return "your wallet";
  return INJECTED_WALLET_LABELS[injectedName] ?? "your wallet";
}

function hasInjectedSubstrateWallet(): boolean {
  if (typeof window === "undefined") return false;
  const injected = (
    window as Window & {
      injectedWeb3?: Record<string, unknown>;
    }
  ).injectedWeb3;
  return Boolean(
    (injected && Object.keys(injected).length > 0) || isWeb3Injected
  );
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

async function waitForSubstrateWalletInjection(
  timeoutMs = 2500
): Promise<boolean> {
  if (hasInjectedSubstrateWallet()) return true;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      for (const event of INJECTED_READY_EVENTS) {
        window.removeEventListener(event, onReady);
      }
      resolve(ok);
    };

    const onReady = () => finish(hasInjectedSubstrateWallet());
    const timer = window.setTimeout(
      () => finish(hasInjectedSubstrateWallet()),
      timeoutMs
    );
    const poll = window.setInterval(() => {
      if (hasInjectedSubstrateWallet()) finish(true);
    }, 100);
    for (const event of INJECTED_READY_EVENTS) {
      window.addEventListener(event, onReady, { once: true });
    }
  });
}

async function ensureVaraExtensions(): Promise<boolean> {
  await ensureVaraCryptoReady();

  if (extensionsEnabled) return true;

  await waitForSubstrateWalletInjection();

  if (!hasInjectedSubstrateWallet()) {
    return false;
  }

  const extensions = await web3Enable(VARA_APP_NAME);
  extensionsEnabled = extensions.length > 0;
  return extensionsEnabled;
}

function missingWalletMessage(): string {
  if (isLikelyMobile()) {
    return "No Substrate wallet detected. On mobile, open ArcadeX inside a wallet in-app browser (SubWallet, Nova, etc.), then connect Vara again.";
  }
  return "No Substrate wallet found. Install SubWallet, polkadot.js, Talisman, or Nova and create a Vara (Substrate) account.";
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
      "No Vara account found. In your wallet, select a Substrate/Vara account (not EVM)."
    );
  }

  if (
    account.type === "ethereum" ||
    isLikelyEvmAddress(account.address) ||
    !isVaraWalletAddress(account.address)
  ) {
    throw new Error(
      "Wallet returned an EVM account. Switch to a Vara / Substrate account, then reconnect."
    );
  }

  // Keep the extension's SS58 as-is so the wallet can sign for this account.
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
