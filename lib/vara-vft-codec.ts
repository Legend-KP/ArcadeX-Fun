/**
 * Minimal VFT / sails payload codec — no @gear-js or @polkadot/types.
 */
import {
  compactToU8a,
  hexToU8a,
  stringToU8a,
  u8aConcat,
  u8aToHex,
} from "@polkadot/util";

export type HexString = `0x${string}`;

function encodeU256(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

function encodeString(value: string): Uint8Array {
  const bytes = stringToU8a(value);
  return u8aConcat(compactToU8a(bytes.length), bytes);
}

function encodeBytes32(hexOrBytes: string | Uint8Array): Uint8Array {
  const bytes =
    typeof hexOrBytes === "string" ? hexToU8a(hexOrBytes) : hexOrBytes;
  if (bytes.length !== 32) {
    throw new Error("Expected 32-byte ActorId / program id.");
  }
  return bytes;
}

/** Encodes sails `(String, String, [u8;32], U256)` for `Vft::Transfer`. */
export function encodeVftTransferPayload(
  toActorId: HexString | string,
  value: bigint
): HexString {
  return u8aToHex(
    u8aConcat(
      encodeString("Vft"),
      encodeString("Transfer"),
      encodeBytes32(toActorId),
      encodeU256(value)
    )
  ) as HexString;
}

/** Encodes sails `(String, String, [u8;32])` for `Vft::BalanceOf`. */
export function encodeVftBalanceOfPayload(
  accountActorId: HexString | string
): HexString {
  return u8aToHex(
    u8aConcat(
      encodeString("Vft"),
      encodeString("BalanceOf"),
      encodeBytes32(accountActorId)
    )
  ) as HexString;
}

/** Encodes sails `(String, String)` for `Vft::Decimals`. */
export function encodeVftDecimalsPayload(): HexString {
  return u8aToHex(
    u8aConcat(encodeString("Vft"), encodeString("Decimals"))
  ) as HexString;
}

function readCompact(bytes: Uint8Array, offset: number): [number, number] {
  const first = bytes[offset];
  const mode = first & 0b11;
  if (mode === 0) return [1, first >> 2];
  if (mode === 1) {
    return [2, ((first | (bytes[offset + 1] << 8)) >> 2) >>> 0];
  }
  if (mode === 2) {
    return [
      4,
      ((first |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>
        2) >>>
        0,
    ];
  }
  throw new Error("Unsupported compact length.");
}

/** Decode `(String, String, U256)` reply from BalanceOf. */
export function decodeVftBalanceOfReply(payloadHex: string): bigint {
  const bytes = hexToU8a(payloadHex);
  let offset = 0;
  // skip two strings
  for (let i = 0; i < 2; i++) {
    const [lenBytes, strLen] = readCompact(bytes, offset);
    offset += lenBytes + strLen;
  }
  let value = BigInt(0);
  for (let i = 0; i < 32; i++) {
    value |= BigInt(bytes[offset + i] ?? 0) << BigInt(8 * i);
  }
  return value;
}

/** Decode `(String, String, u8)` reply from Decimals. */
export function decodeVftDecimalsReply(payloadHex: string): number {
  const bytes = hexToU8a(payloadHex);
  let offset = 0;
  for (let i = 0; i < 2; i++) {
    const [lenBytes, strLen] = readCompact(bytes, offset);
    offset += lenBytes + strLen;
  }
  return bytes[offset] ?? 0;
}
