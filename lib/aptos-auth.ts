import { Ed25519PublicKey, Ed25519Signature } from "@aptos-labs/ts-sdk";
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

export function verifyAptosSignMessage(output: AptosSignMessageOutput): boolean {
  if (!output.fullMessage || !output.signature || !output.publicKey) {
    return false;
  }

  try {
    const publicKey = new Ed25519PublicKey(output.publicKey);
    const signature = new Ed25519Signature(output.signature);
    return publicKey.verifySignature({
      message: output.fullMessage,
      signature,
    });
  } catch {
    return false;
  }
}
