import { signatureVerify } from "@polkadot/util-crypto";

export function verifyVaraSignature(
  message: string,
  signature: string,
  address: string
): boolean {
  try {
    const { isValid } = signatureVerify(message, signature, address);
    return isValid;
  } catch {
    return false;
  }
}
