"use client";

import { buildPlainAuthMessage } from "@/lib/plain-auth";
import type { AptosSignMessageOutput } from "@/lib/aptos-auth";

interface AptosWallet {
  connect(): Promise<{ address: string; publicKey?: string }>;
  disconnect(): Promise<void>;
  account?(): Promise<{ address: string; publicKey?: string }>;
  isConnected?(): Promise<boolean>;
  signMessage(payload: {
    message: string;
    nonce: string;
  }): Promise<AptosSignMessageOutput>;
}

function getAptosWallet(): AptosWallet {
  const wallet = (window as Window & { aptos?: AptosWallet }).aptos;
  if (!wallet) {
    throw new Error(
      "Petra wallet not found. Install the Petra browser extension."
    );
  }
  return wallet;
}

export async function connectPetraWallet(): Promise<{
  address: string;
  publicKey?: string;
}> {
  const wallet = getAptosWallet();
  const result = await wallet.connect();
  if (!result.address) {
    throw new Error("Could not connect Petra wallet.");
  }
  return result;
}

export async function reconnectPetraWallet(opts?: {
  allowPrompt?: boolean;
}): Promise<{ address: string; publicKey?: string }> {
  const wallet = getAptosWallet();
  const allowPrompt = opts?.allowPrompt !== false;

  try {
    if (typeof wallet.isConnected === "function") {
      const connected = await wallet.isConnected();
      if (connected && typeof wallet.account === "function") {
        const account = await wallet.account();
        if (account?.address) return account;
      }
      if (connected && !allowPrompt) {
        throw new Error("Petra wallet is not connected to this site.");
      }
    } else if (typeof wallet.account === "function") {
      const account = await wallet.account();
      if (account?.address) return account;
    }
  } catch (err) {
    if (!allowPrompt) throw err;
  }

  if (!allowPrompt) {
    throw new Error("Petra wallet is not connected to this site.");
  }

  return connectPetraWallet();
}

export async function disconnectPetraWallet(): Promise<void> {
  const wallet = (window as Window & { aptos?: AptosWallet }).aptos;
  if (!wallet) return;
  try {
    await wallet.disconnect();
  } catch {
    // ignore
  }
}

export async function signPetraMessage(
  nonce: string,
  publicKey?: string
): Promise<AptosSignMessageOutput> {
  const wallet = getAptosWallet();
  const message = buildPlainAuthMessage(nonce);
  const output = await wallet.signMessage({ message, nonce });
  return { ...output, publicKey: output.publicKey ?? publicKey };
}
