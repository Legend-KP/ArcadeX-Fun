"use client";

import {
  web3Accounts,
  web3Enable,
  web3FromAddress,
  isWeb3Injected,
} from "@polkadot/extension-dapp";
import { stringToU8a, u8aToHex } from "@polkadot/util";
import { buildVaraAuthMessage } from "@/lib/vara-auth";
import {
  ensureVaraCryptoReady,
  isLikelyEvmAddress,
  isVaraWalletAddress,
} from "@/lib/vara-address";

const VARA_APP_NAME = "ArcadeX";
const WEB3_ENABLE_TIMEOUT_MS = 30_000;
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

export type VaraWalletAccount = {
  address: string;
  name: string;
  source: string;
  sourceLabel: string;
};

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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
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

/**
 * Enable injected Substrate extensions. Times out if the permission prompt
 * hangs or the user never responds — same class of bug as an unguarded
 * Coinbase/wagmi connect.
 */
export async function ensureVaraExtensions(): Promise<boolean> {
  await ensureVaraCryptoReady();

  if (extensionsEnabled) return true;

  await waitForSubstrateWalletInjection();

  if (!hasInjectedSubstrateWallet()) {
    return false;
  }

  const extensions = await withTimeout(
    web3Enable(VARA_APP_NAME),
    WEB3_ENABLE_TIMEOUT_MS,
    "Wallet didn't respond. Approve ArcadeX in your wallet, then try again."
  );
  extensionsEnabled = extensions.length > 0;
  return extensionsEnabled;
}

function missingWalletMessage(): string {
  if (isLikelyMobile()) {
    return "No Substrate wallet detected. On mobile, open ArcadeX inside a wallet in-app browser (SubWallet, Nova, etc.), then connect Vara again.";
  }
  return "No Substrate wallet found. Install SubWallet, polkadot.js, Talisman, or Nova and create a Vara (Substrate) account.";
}

function isSubstrateVaraAccount(account: {
  address: string;
  type?: string;
}): boolean {
  if (account.type === "ethereum") return false;
  if (isLikelyEvmAddress(account.address)) return false;
  return isVaraWalletAddress(account.address);
}

export async function listVaraWalletAccounts(): Promise<VaraWalletAccount[]> {
  const ready = await ensureVaraExtensions();
  if (!ready) {
    throw new Error(missingWalletMessage());
  }

  const accounts = await web3Accounts();
  const substrateAccounts = accounts.filter(isSubstrateVaraAccount);

  if (substrateAccounts.length === 0) {
    throw new Error(
      "No Vara account found. In your wallet, select a Substrate/Vara account (not EVM)."
    );
  }

  return substrateAccounts.map((account) => ({
    address: account.address,
    name: account.meta.name?.trim() || "",
    source: account.meta.source,
    sourceLabel: varaWalletLabel(account.meta.source),
  }));
}

/** @deprecated Prefer listVaraWalletAccounts + an account picker. */
export async function connectVaraWallet(): Promise<string> {
  const accounts = await listVaraWalletAccounts();
  return accounts[0]!.address;
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

  const domain =
    typeof window !== "undefined" ? window.location.host : "arcadex.fun";
  const uri =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://arcadex.fun";
  const message = buildVaraAuthMessage(nonce, domain, uri);
  const { signature } = await injector.signer.signRaw({
    address,
    data: u8aToHex(stringToU8a(message)),
    type: "bytes",
  });

  return { address, signature, message };
}
