/**
 * Vara signature verify — sr25519 via @polkadot/util-crypto.
 * Force ASM.js init so the WASM blob (and OpenNext `proving\00` crash) stays out.
 */
import "@polkadot/wasm-crypto/initOnlyAsm";
import { cryptoWaitReady, signatureVerify } from "@polkadot/util-crypto";

let ready: Promise<boolean> | null = null;

function ensureReady(): Promise<boolean> {
  if (!ready) ready = cryptoWaitReady();
  return ready;
}

export async function verifyVaraSignature(
  message: string,
  signature: string,
  address: string
): Promise<boolean> {
  try {
    await ensureReady();
    const { isValid } = signatureVerify(message, signature, address);
    return isValid;
  } catch {
    return false;
  }
}
