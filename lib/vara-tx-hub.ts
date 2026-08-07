/**
 * ArcadeXTxHub client constants + play purpose hashing.
 *
 * Play purpose (documented): blake2b-256 of UTF-8 `PLAY:{gameId}`.
 */
import { blake2b } from "@noble/hashes/blake2b";
import { stringToU8a, u8aToHex } from "@polkadot/util";
import type { HexString } from "@/lib/shop-vara";
import { VARA_RPC_URL } from "@/lib/shop-vara";

export const VARA_TX_HUB_EXPLORER_TX_URL = "https://vara.subscan.io/extrinsic";

export const VARA_TX_HUB_PROGRAM_ID = (process.env
  .NEXT_PUBLIC_VARA_ARCADEX_TX_HUB_PROGRAM?.trim() || "") as HexString | "";

/** Sails service + method routes (PascalCase), matching the on-chain program. */
export const VARA_TX_HUB_SERVICE = "ArcadeXTxHub";
export const VARA_TX_HUB_SIGN_IN_METHOD = "SignIn";

export function assertVaraTxHubConfigured(): asserts VARA_TX_HUB_PROGRAM_ID is HexString {
  if (!VARA_TX_HUB_PROGRAM_ID || !/^0x[0-9a-fA-F]{64}$/.test(VARA_TX_HUB_PROGRAM_ID)) {
    throw new Error(
      "Vara TxHub program is not configured. Set NEXT_PUBLIC_VARA_ARCADEX_TX_HUB_PROGRAM."
    );
  }
}

export function isVaraTxHubConfigured(): boolean {
  return Boolean(
    VARA_TX_HUB_PROGRAM_ID && /^0x[0-9a-fA-F]{64}$/.test(VARA_TX_HUB_PROGRAM_ID)
  );
}

/**
 * Play purpose digest for Start Game.
 * `blake2b-256("PLAY:{gameId}")` → 32-byte hex.
 */
export function playPurpose(gameId: string): HexString {
  const id = gameId.trim();
  if (!id) throw new Error("gameId is required for play purpose.");
  const digest = blake2b(stringToU8a(`PLAY:${id}`), { dkLen: 32 });
  return u8aToHex(digest) as HexString;
}

export function purposeBytes(purposeHex: HexString | string): Uint8Array {
  const hex = purposeHex.startsWith("0x") ? purposeHex.slice(2) : purposeHex;
  if (hex.length !== 64) {
    throw new Error("Purpose must be 32 bytes.");
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export { VARA_RPC_URL };
