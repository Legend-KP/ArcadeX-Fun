/**
 * Minimal SS58 encode/decode — no `@polkadot/util-crypto` WASM.
 * Checksum is blake2b("SS58PRE" + payload) as in the Substrate spec.
 */
import { blake2b } from "@noble/hashes/blake2b";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SS58_PRE = new TextEncoder().encode("SS58PRE");

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ss58PrefixBytes(prefix: number): Uint8Array {
  if (prefix < 0 || prefix > 16383) {
    throw new Error("Invalid SS58 prefix");
  }
  if (prefix < 64) {
    return Uint8Array.of(prefix);
  }
  return Uint8Array.of(
    ((prefix & 0b0000_0000_1111_1100) >> 2) | 0b0100_0000,
    (prefix >> 8) | ((prefix & 0b0000_0000_0000_0011) << 6)
  );
}

function decodeSs58Prefix(bytes: Uint8Array): { prefix: number; offset: number } {
  const first = bytes[0];
  if ((first & 0b0100_0000) === 0) {
    return { prefix: first, offset: 1 };
  }
  if (bytes.length < 2) {
    throw new Error("Invalid SS58 address");
  }
  const prefix =
    ((first & 0b0011_1111) << 2) | (bytes[1] >> 6) | ((bytes[1] & 0b0011_1111) << 8);
  return { prefix, offset: 2 };
}

function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]];
  }
  return out;
}

function base58Decode(value: string): Uint8Array {
  let zeros = 0;
  while (zeros < value.length && value[zeros] === "1") zeros += 1;

  const bytes = [0];
  for (let i = zeros; i < value.length; i++) {
    const idx = BASE58_ALPHABET.indexOf(value[i]);
    if (idx < 0) throw new Error("Invalid SS58 address");
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[out.length - 1 - i] = bytes[i];
  }
  return out;
}

function ss58Checksum(payload: Uint8Array): Uint8Array {
  return blake2b(concatBytes(SS58_PRE, payload), { dkLen: 64 }).subarray(0, 2);
}

export function decodeSs58Address(address: string): Uint8Array {
  const decoded = base58Decode(address.trim());
  if (decoded.length < 3) {
    throw new Error("Invalid SS58 address");
  }
  const checksum = decoded.subarray(decoded.length - 2);
  const payload = decoded.subarray(0, decoded.length - 2);
  const expected = ss58Checksum(payload);
  if (checksum[0] !== expected[0] || checksum[1] !== expected[1]) {
    throw new Error("Invalid SS58 address");
  }
  const { offset } = decodeSs58Prefix(payload);
  const pub = payload.subarray(offset);
  if (pub.length !== 32) {
    throw new Error("Invalid SS58 address");
  }
  return pub;
}

export function encodeSs58Address(
  publicKey: Uint8Array,
  prefix: number
): string {
  if (publicKey.length !== 32) {
    throw new Error("Invalid Vara public key");
  }
  const payload = concatBytes(ss58PrefixBytes(prefix), publicKey);
  return base58Encode(concatBytes(payload, ss58Checksum(payload)));
}
