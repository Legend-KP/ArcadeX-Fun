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
