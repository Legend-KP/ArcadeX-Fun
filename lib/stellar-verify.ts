import { Keypair } from "@stellar/stellar-sdk";

export function verifyStellarSignedMessage(
  message: string,
  signedMessage: string,
  address: string
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(address);
    return keypair.verify(
      Buffer.from(message),
      Buffer.from(signedMessage, "base64")
    );
  } catch {
    return false;
  }
}
