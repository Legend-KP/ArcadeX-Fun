/**
 * Minimal Sails string-route codec for ArcadeXTxHub (sails-rs 0.9.x style).
 * Matches the same SCALE string prefix pattern used by VFT helpers.
 */
import {
  compactToU8a,
  stringToU8a,
  u8aConcat,
  u8aToHex,
} from "@polkadot/util";
import type { HexString } from "@/lib/shop-vara";
import {
  VARA_TX_HUB_SERVICE,
  VARA_TX_HUB_SIGN_IN_METHOD,
  purposeBytes,
} from "@/lib/vara-tx-hub";

function encodeString(value: string): Uint8Array {
  const bytes = stringToU8a(value);
  return u8aConcat(compactToU8a(bytes.length), bytes);
}

/** Encodes `ArcadeXTxHub::SignIn(purpose: [u8;32])`. */
export function encodeTxHubSignInPayload(
  purposeHex: HexString | string
): HexString {
  const purpose = purposeBytes(purposeHex);
  return u8aToHex(
    u8aConcat(
      encodeString(VARA_TX_HUB_SERVICE),
      encodeString(VARA_TX_HUB_SIGN_IN_METHOD),
      purpose
    )
  ) as HexString;
}
