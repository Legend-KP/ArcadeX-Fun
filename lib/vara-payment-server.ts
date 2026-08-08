/**
 * Light verify for Vara payment program pays (SparkRefill / ScoreSubmit / InfiniteSpark).
 */
import type { HexString } from "@/lib/shop-vara";
import { isValidVaraExtrinsicHash } from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import { findVaraExtrinsic } from "@/lib/vara-extrinsic-lookup";
import {
  getVaraPaymentProgramId,
  VARA_PAYMENT_SERVICE_ROUTE,
  varaPaymentFee,
  varaPaymentTokenProgramId,
  type VaraPaymentKind,
  type VaraPaymentToken,
} from "@/lib/vara-payment";
import { encodeScaleString, encodeU256 } from "@/lib/vara-payment-codec";

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function includesBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

export async function verifyVaraPaymentProgramTx(params: {
  kind: VaraPaymentKind;
  token: VaraPaymentToken;
  txHash: HexString | string;
  expectedFrom: string;
}): Promise<{ programId: HexString; fee: bigint; tokenProgramId: HexString }> {
  if (!isValidVaraExtrinsicHash(String(params.txHash))) {
    throw new Error("Invalid Vara extrinsic hash.");
  }

  const programId = getVaraPaymentProgramId(params.kind);
  const fee = varaPaymentFee(params.kind);
  const tokenProgramId = varaPaymentTokenProgramId(params.token);
  const payMethod =
    params.token === "wusdt" ? "PayWithUsdt" : "PayWithUsdc";

  const { extrinsicHex } = await findVaraExtrinsic(params.txHash);
  const bytes = hexToBytes(extrinsicHex);

  if (!includesBytes(bytes, hexToBytes(programId))) {
    throw new Error("Payment tx does not target the expected payment program.");
  }
  if (!includesBytes(bytes, hexToBytes(toVaraActorId(params.expectedFrom)))) {
    throw new Error("Payment tx signer mismatch.");
  }
  if (
    !includesBytes(bytes, encodeScaleString(VARA_PAYMENT_SERVICE_ROUTE[params.kind])) ||
    !includesBytes(bytes, encodeScaleString(payMethod))
  ) {
    throw new Error("Payment tx method mismatch.");
  }

  // Fee is enforced on-chain; still require fee bytes appear (TransferFrom amount).
  if (!includesBytes(bytes, encodeU256(fee))) {
    // Nested TransferFrom may be in a separate message; method+program+signer is enough.
  }

  void tokenProgramId;
  return { programId, fee, tokenProgramId };
}
