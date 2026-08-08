/**
 * Sails codecs for VFT Approve + payment program PayWithUsdt/PayWithUsdc.
 */
import {
  compactToU8a,
  stringToU8a,
  u8aConcat,
  u8aToHex,
  hexToU8a,
} from "@polkadot/util";
import type { HexString } from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import {
  VARA_PAYMENT_SERVICE_ROUTE,
  type VaraPaymentKind,
} from "@/lib/vara-payment";

function encodeString(value: string): Uint8Array {
  const bytes = stringToU8a(value);
  return u8aConcat(compactToU8a(bytes.length), bytes);
}

function encodeBytes32(hexOrBytes: string | Uint8Array): Uint8Array {
  const bytes =
    typeof hexOrBytes === "string" ? hexToU8a(hexOrBytes) : hexOrBytes;
  if (bytes.length !== 32) {
    throw new Error("Expected 32-byte ActorId.");
  }
  return bytes;
}

function encodeU256(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

/** `Vft::Approve(spender, value)` */
export function encodeVftApprovePayload(
  spenderActorId: HexString | string,
  value: bigint
): HexString {
  return u8aToHex(
    u8aConcat(
      encodeString("Vft"),
      encodeString("Approve"),
      encodeBytes32(toVaraActorId(spenderActorId)),
      encodeU256(value)
    )
  ) as HexString;
}

/** `SparkRefill|ScoreSubmit|InfiniteSpark::PayWithUsdt` / `PayWithUsdc` */
export function encodePaymentPayPayload(
  kind: VaraPaymentKind,
  method: "PayWithUsdt" | "PayWithUsdc"
): HexString {
  return u8aToHex(
    u8aConcat(
      encodeString(VARA_PAYMENT_SERVICE_ROUTE[kind]),
      encodeString(method)
    )
  ) as HexString;
}

export function encodeScaleString(value: string): Uint8Array {
  return encodeString(value);
}

export { encodeU256 };
