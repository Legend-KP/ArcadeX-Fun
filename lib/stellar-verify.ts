/**
 * Stellar account-ID verify without `@stellar/stellar-sdk`.
 * Freighter signatures are ed25519 over the raw message bytes.
 */
import { ed25519 } from "@noble/curves/ed25519";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STELLAR_ACCOUNT_VERSION = 6 << 3; // 48

function crc16xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32Decode(value: string): Uint8Array {
  const cleaned = value.replace(/=+$/g, "").toUpperCase();
  let bits = 0;
  let buffer = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid Stellar address");
    buffer = (buffer << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function decodeStellarPublicKey(address: string): Uint8Array {
  const decoded = base32Decode(address.trim());
  if (decoded.length !== 35) {
    throw new Error("Invalid Stellar address");
  }
  const payload = decoded.subarray(0, 33);
  const checksum = decoded[33] | (decoded[34] << 8);
  if (payload[0] !== STELLAR_ACCOUNT_VERSION) {
    throw new Error("Invalid Stellar address");
  }
  if (crc16xmodem(payload) !== checksum) {
    throw new Error("Invalid Stellar address");
  }
  return payload.subarray(1);
}

function decodeBase64(value: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}

export function verifyStellarSignedMessage(
  message: string,
  signedMessage: string,
  address: string
): boolean {
  try {
    const publicKey = decodeStellarPublicKey(address);
    const signature = decodeBase64(signedMessage);
    const payload = new TextEncoder().encode(message);
    return ed25519.verify(signature, payload, publicKey);
  } catch {
    return false;
  }
}
