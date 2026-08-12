/**
 * Lightweight Sui personal-message verify (Ed25519 only).
 * Avoids bundling `@mysten/sui/verify` into the Cloudflare Worker.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import { normalizeSuiAddress } from "@/lib/sui-address-lite";

const INTENT_PERSONAL_MESSAGE = 3;
const INTENT_VERSION_V0 = 0;
const APP_ID_SUI = 0;
const FLAG_ED25519 = 0x00;

function uleb128(value: number): Uint8Array {
  const out: number[] = [];
  let n = value >>> 0;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return Uint8Array.from(out);
}

function bcsVectorU8(bytes: Uint8Array): Uint8Array {
  const len = uleb128(bytes.length);
  const out = new Uint8Array(len.length + bytes.length);
  out.set(len, 0);
  out.set(bytes, len.length);
  return out;
}

function messageWithIntent(data: Uint8Array): Uint8Array {
  const intent = Uint8Array.of(
    INTENT_PERSONAL_MESSAGE,
    INTENT_VERSION_V0,
    APP_ID_SUI
  );
  const out = new Uint8Array(intent.length + data.length);
  out.set(intent, 0);
  out.set(data, intent.length);
  return out;
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

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function suiAddressFromEd25519PublicKey(publicKey: Uint8Array): string {
  const input = new Uint8Array(1 + publicKey.length);
  input[0] = FLAG_ED25519;
  input.set(publicKey, 1);
  return normalizeSuiAddress(bytesToHex(blake2b(input, { dkLen: 32 })));
}

export async function isValidPersonalMessageSignature(
  message: Uint8Array,
  signature: string,
  options: { address: string }
): Promise<boolean> {
  try {
    const raw = decodeBase64(signature.trim());
    if (raw.length < 1 + 64 + 32) return false;
    if (raw[0] !== FLAG_ED25519) {
      // Only Ed25519 is implemented here; other schemes are uncommon for ArcadeX.
      return false;
    }

    const sig = raw.subarray(1, 65);
    const publicKey = raw.subarray(65, 97);
    const expected = normalizeSuiAddress(options.address);
    const derived = suiAddressFromEd25519PublicKey(publicKey);
    if (derived !== expected) return false;

    const digest = blake2b(messageWithIntent(bcsVectorU8(message)), {
      dkLen: 32,
    });
    return ed25519.verify(sig, digest, publicKey);
  } catch {
    return false;
  }
}
