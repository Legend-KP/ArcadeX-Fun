import { ed25519 } from "@noble/curves/ed25519";
import { isPlainAuthMessageValid } from "@/lib/plain-auth";

export interface AptosSignMessageOutput {
  address: string;
  application: string;
  chainId: number;
  fullMessage: string;
  message: string;
  nonce: string;
  prefix: string;
  signature: string;
  type: string;
  publicKey?: string;
}

export function isAptosAuthMessageValid(message: string, nonce: string): boolean {
  return isPlainAuthMessageValid(message, nonce);
}

function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function verifyAptosSignMessage(output: AptosSignMessageOutput): boolean {
  if (!output.fullMessage || !output.signature || !output.publicKey) {
    return false;
  }

  try {
    const publicKey = hexToBytes(output.publicKey);
    const signature = hexToBytes(output.signature);
    if (publicKey.length !== 32 || signature.length !== 64) {
      return false;
    }
    return ed25519.verify(
      signature,
      new TextEncoder().encode(output.fullMessage),
      publicKey
    );
  } catch {
    return false;
  }
}
