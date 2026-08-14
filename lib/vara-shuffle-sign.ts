/**
 * sr25519 shuffle spin signatures for Vara ArcadeXRewards lite.
 * Message format must stay in sync with prepare/sync verification.
 *
 * ASM.js init avoids the WASM blob that OpenNext/esbuild rejects (`proving\00`).
 */
import "@polkadot/wasm-crypto/initOnlyAsm";
import { hexToU8a, stringToU8a, u8aToHex } from "@polkadot/util";
import {
  cryptoWaitReady,
  sr25519PairFromSeed,
  sr25519Sign,
  signatureVerify,
} from "@polkadot/util-crypto";
import {
  assertVaraArcadeXRewardsConfigured,
  VARA_ARCADEX_REWARDS_PROGRAM_ID,
} from "@/lib/vara-rewards";
import { toVaraActorId } from "@/lib/vara-address";

let ready: Promise<boolean> | null = null;

function ensureReady(): Promise<boolean> {
  if (!ready) ready = cryptoWaitReady();
  return ready;
}

function getSpinPrivateKeyBytes(): Uint8Array {
  const raw =
    process.env.VARA_SPIN_RESULT_PRIVATE_KEY?.trim() ||
    process.env.SPIN_RESULT_PRIVATE_KEY?.trim() ||
    "";
  if (!raw) {
    throw new Error(
      "VARA_SPIN_RESULT_PRIVATE_KEY is not configured for Vara shuffle."
    );
  }
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  const bytes = hexToU8a(normalized);
  if (bytes.length !== 32 && bytes.length !== 64) {
    throw new Error(
      "VARA_SPIN_RESULT_PRIVATE_KEY must be 32-byte seed or 64-byte secret key."
    );
  }
  return bytes;
}

function getSpinPublicKeyHex(): string {
  const raw = process.env.VARA_SPIN_RESULT_PUBLIC_KEY?.trim() || "";
  if (raw && /^0x[0-9a-fA-F]{64}$/.test(raw)) {
    return raw.toLowerCase();
  }
  return "";
}

function pairFromPrivateKey(secret: Uint8Array): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
} {
  if (secret.length === 32) {
    return sr25519PairFromSeed(secret);
  }
  const pubHex = getSpinPublicKeyHex();
  if (!pubHex) {
    throw new Error(
      "64-byte VARA_SPIN_RESULT_PRIVATE_KEY requires VARA_SPIN_RESULT_PUBLIC_KEY."
    );
  }
  return { secretKey: secret, publicKey: hexToU8a(pubHex) };
}

/** Canonical message signed for Vara shuffle spins. */
export function buildVaraSpinMessage(params: {
  player: string;
  campaignId: number;
  rewardMode: number;
  rewardAmount: bigint | number;
  nonce: number | bigint;
  deadline: number | bigint;
}): string {
  const programId = assertVaraArcadeXRewardsConfigured();
  const player = toVaraActorId(params.player);
  return [
    "ArcadeXRewards:Spin:v1",
    programId.toLowerCase(),
    player.toLowerCase(),
    String(params.campaignId),
    String(params.rewardMode),
    String(params.rewardAmount),
    String(params.nonce),
    String(params.deadline),
  ].join("|");
}

export async function signVaraShuffleSpin(params: {
  player: string;
  campaignId: number;
  rewardMode: number;
  rewardAmount: bigint | number;
  nonce: number | bigint;
  deadline: number | bigint;
}): Promise<`0x${string}`> {
  await ensureReady();
  void VARA_ARCADEX_REWARDS_PROGRAM_ID;
  const message = buildVaraSpinMessage(params);
  const pair = pairFromPrivateKey(getSpinPrivateKeyBytes());
  const sig = sr25519Sign(stringToU8a(message), pair);
  return u8aToHex(sig) as `0x${string}`;
}

export async function verifyVaraShuffleSpinSignature(params: {
  player: string;
  campaignId: number;
  rewardMode: number;
  rewardAmount: bigint | number;
  nonce: number | bigint;
  deadline: number | bigint;
  signature: string;
}): Promise<boolean> {
  await ensureReady();
  const message = buildVaraSpinMessage(params);
  const pubHex = getSpinPublicKeyHex();
  if (!pubHex) {
    // Fall back: reconstruct from seed if 32-byte.
    try {
      const secret = getSpinPrivateKeyBytes();
      if (secret.length === 32) {
        const pair = sr25519PairFromSeed(secret);
        const { isValid } = signatureVerify(
          message,
          params.signature,
          u8aToHex(pair.publicKey)
        );
        return isValid;
      }
    } catch {
      return false;
    }
    return false;
  }
  try {
    const { isValid } = signatureVerify(message, params.signature, pubHex);
    return isValid;
  } catch {
    return false;
  }
}
