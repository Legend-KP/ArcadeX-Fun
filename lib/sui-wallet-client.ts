"use client";

import {
  getWallets,
  SuiSignPersonalMessage,
  type SuiSignPersonalMessageFeature,
  type Wallet,
  type WalletAccount,
} from "@mysten/wallet-standard";
import {
  StandardConnect,
  StandardDisconnect,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
} from "@wallet-standard/features";
import { registerSlushWallet, SLUSH_WALLET_NAME } from "@mysten/slush-wallet";

let slushRegistered = false;
let activeSuiWallet: Wallet | null = null;

export function ensureSlushWalletRegistered(): void {
  if (slushRegistered || typeof window === "undefined") return;
  registerSlushWallet("ArcadeX");
  slushRegistered = true;
}

function findSlushWallet(): Wallet | undefined {
  const wallets = getWallets().get();
  return (
    wallets.find((wallet) => wallet.name === SLUSH_WALLET_NAME) ??
    wallets.find((wallet) => wallet.name.toLowerCase().includes("slush"))
  );
}

export async function connectSlushWallet(): Promise<{
  wallet: Wallet;
  account: WalletAccount;
}> {
  ensureSlushWalletRegistered();

  const wallet = findSlushWallet();
  if (!wallet) {
    throw new Error(
      "Slush wallet not found. Install the Slush browser extension or approve the web wallet."
    );
  }

  const connectFeature = wallet.features[StandardConnect] as
    | StandardConnectFeature[typeof StandardConnect]
    | undefined;
  if (!connectFeature) {
    throw new Error("Slush wallet does not support connect.");
  }

  const { accounts } = await connectFeature.connect();
  const account = accounts[0];
  if (!account) {
    throw new Error("Could not connect Slush wallet.");
  }

  activeSuiWallet = wallet;
  return { wallet, account };
}

export async function disconnectSlushWallet(): Promise<void> {
  if (!activeSuiWallet) return;

  const disconnectFeature = activeSuiWallet.features[StandardDisconnect] as
    | StandardDisconnectFeature[typeof StandardDisconnect]
    | undefined;
  if (disconnectFeature) {
    try {
      await disconnectFeature.disconnect();
    } catch {
      // ignore
    }
  }

  activeSuiWallet = null;
}

export async function signSlushPersonalMessage(
  wallet: Wallet,
  account: WalletAccount,
  message: Uint8Array
): Promise<string> {
  const signFeature = wallet.features[SuiSignPersonalMessage] as
    | SuiSignPersonalMessageFeature[typeof SuiSignPersonalMessage]
    | undefined;

  if (!signFeature) {
    throw new Error("Slush wallet does not support personal message signing.");
  }

  const { signature } = await signFeature.signPersonalMessage({
    message,
    account,
  });

  return signature;
}
