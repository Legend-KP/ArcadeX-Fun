"use client";

import { buildPlainAuthMessage } from "@/lib/plain-auth";
import type { AptosSignMessageOutput } from "@/lib/aptos-auth";

interface MovementWallet {
  connect(): Promise<{ address: string; publicKey?: string }>;
  disconnect(): Promise<void>;
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
