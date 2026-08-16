"use client";

import { buildPlainAuthMessage } from "@/lib/plain-auth";
import type { AptosSignMessageOutput } from "@/lib/aptos-auth";

interface MovementWallet {
  connect(): Promise<{ address: string; publicKey?: string }>;
  disconnect(): Promise<void>;
  account?(): Promise<{ address: string; publicKey?: string }>;
  isConnected?(): Promise<boolean>;
  signMessage(payload: {
    message: string;
    nonce: string;
  }): Promise<AptosSignMessageOutput>;
}

function getMovementWallet(): MovementWallet {
  const movement = (window as Window & { movement?: MovementWallet }).movement;
  if (movement) return movement;

  const nightly = (window as Window & { nightly?: MovementWallet }).nightly;
  if (nightly) return nightly;

  throw new Error(
    "Movement wallet not found. Install Nightly or another Movement-compatible wallet."
  );
}

export async function connectMovementWallet(): Promise<{
  address: string;
  publicKey?: string;
}> {
  const wallet = getMovementWallet();
  const result = await wallet.connect();
  if (!result.address) {
    throw new Error("Could not connect Movement wallet.");
  }
  return result;
}

export async function reconnectMovementWallet(opts?: {
  allowPrompt?: boolean;
}): Promise<{ address: string; publicKey?: string }> {
  const wallet = getMovementWallet();
  const allowPrompt = opts?.allowPrompt !== false;

  try {
    if (typeof wallet.isConnected === "function") {
      const connected = await wallet.isConnected();
      if (connected && typeof wallet.account === "function") {
        const account = await wallet.account();
        if (account?.address) return account;
      }
      if (connected && !allowPrompt) {
        throw new Error("Movement wallet is not connected to this site.");
      }
    } else if (typeof wallet.account === "function") {
      const account = await wallet.account();
      if (account?.address) return account;
    }
  } catch (err) {
    if (!allowPrompt) throw err;
  }

  if (!allowPrompt) {
    throw new Error("Movement wallet is not connected to this site.");
  }

  return connectMovementWallet();
}

export async function disconnectMovementWallet(): Promise<void> {
  const movement = (window as Window & { movement?: MovementWallet }).movement;
  const nightly = (window as Window & { nightly?: MovementWallet }).nightly;
  const wallet = movement ?? nightly;
  if (!wallet) return;
  try {
    await wallet.disconnect();
  } catch {
    // ignore
  }
}

export async function signMovementMessage(
  nonce: string,
  publicKey?: string
): Promise<AptosSignMessageOutput> {
  const wallet = getMovementWallet();
  const message = buildPlainAuthMessage(nonce);
  const output = await wallet.signMessage({ message, nonce });
  return { ...output, publicKey: output.publicKey ?? publicKey };
}
