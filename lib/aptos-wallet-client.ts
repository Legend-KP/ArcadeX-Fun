"use client";

import { buildPlainAuthMessage } from "@/lib/plain-auth";
import type { AptosSignMessageOutput } from "@/lib/aptos-auth";

interface AptosWallet {
  connect(): Promise<{ address: string; publicKey?: string }>;
  disconnect(): Promise<void>;
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
