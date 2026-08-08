/**
 * Lightweight ArcadeXTxHub sign_in verification for Cloudflare Workers.
 * Byte-scans the extrinsic for program id, purpose, signer, and SignIn route.
 */
import type { HexString } from "@/lib/shop-vara";
import { isValidVaraExtrinsicHash } from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import { findVaraExtrinsic } from "@/lib/vara-extrinsic-lookup";
import {
  assertVaraTxHubConfigured,
  playPurpose,
  purposeBytes,
  VARA_TX_HUB_SERVICE,
  VARA_TX_HUB_SIGN_IN_METHOD,
} from "@/lib/vara-tx-hub";
import { encodeTxHubSignInPayload } from "@/lib/vara-tx-hub-codec";
import { compactToU8a, stringToU8a, u8aConcat } from "@polkadot/util";

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

function encodeScaleString(value: string): Uint8Array {
  const bytes = stringToU8a(value);
  return u8aConcat(compactToU8a(bytes.length), bytes);
}

export async function verifyVaraTxHubSignIn(params: {
  txHash: HexString | string;
  expectedFrom: string;
  gameId: string;
}): Promise<{ purpose: HexString; programId: HexString }> {
  const programIdHex = assertVaraTxHubConfigured();

  if (!isValidVaraExtrinsicHash(String(params.txHash))) {
    throw new Error("Invalid Vara extrinsic hash.");
  }

  const purpose = playPurpose(params.gameId);
  const expectedPayload = hexToBytes(encodeTxHubSignInPayload(purpose));
  const { extrinsicHex } = await findVaraExtrinsic(params.txHash);
  const bytes = hexToBytes(extrinsicHex);

  const programId = hexToBytes(programIdHex.toLowerCase());
  if (!includesBytes(bytes, programId)) {
    throw new Error("Sign-in transaction does not target ArcadeXTxHub.");
  }

  const signerId = hexToBytes(toVaraActorId(params.expectedFrom));
  if (!includesBytes(bytes, signerId)) {
    throw new Error("Sign-in transaction signer mismatch.");
  }

  if (!includesBytes(bytes, purposeBytes(purpose))) {
    throw new Error("Sign-in transaction purpose mismatch.");
  }

  // Prefer full payload match; fall back to route prefixes (gas/encoding variants).
  if (!includesBytes(bytes, expectedPayload)) {
    const service = encodeScaleString(VARA_TX_HUB_SERVICE);
    const method = encodeScaleString(VARA_TX_HUB_SIGN_IN_METHOD);
    if (!includesBytes(bytes, service) || !includesBytes(bytes, method)) {
      throw new Error("Sign-in transaction method mismatch.");
    }
  }

  return {
    purpose,
    programId: programIdHex,
  };
}
