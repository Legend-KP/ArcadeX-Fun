import { checkRateLimit } from "@/lib/rate-limit";
import { signCastAdd } from "@/lib/farcaster/signer/cast";
import {
  KEY_STATE_ADDED,
  KEY_STATE_REMOVED,
  readSignerState,
} from "@/lib/farcaster/signer/chain";
import { openCastSigner } from "@/lib/farcaster/signer/envelope";
import { SignerHttpError } from "@/lib/farcaster/signer/errors";
import { submitMessage } from "@/lib/farcaster/signer/hub";
import {
  CAST_DAILY_LIMIT,
  CAST_HOURLY_LIMIT,
  CAST_ONLY_PERMISSION,
} from "@/lib/farcaster/signer/permissions";
import {
  getActiveSigner,
  markSignerStatus,
  writeSignerAudit,
} from "@/lib/farcaster/signer/registry";
import {
  deleteSignerEnvelope,
  getSignerEnvelope,
} from "@/lib/farcaster/signer/vault";
import type { Hex } from "viem";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function wipe(bytes: Uint8Array | null) {
  bytes?.fill(0);
}

async function assertCastRate(fid: number, ip: string) {
  const checks = [
    [`farcaster:cast:${fid}`, CAST_HOURLY_LIMIT, HOUR_MS],
    [`farcaster:cast:day:${fid}`, CAST_DAILY_LIMIT, DAY_MS],
    [`farcaster:cast:ip:${ip}`, 30, HOUR_MS],
  ] as const;
  for (const [key, limit, windowMs] of checks) {
    if (!(await checkRateLimit(key, limit, windowMs))) {
      throw new SignerHttpError(
        "Too many casts for this account. Try again later.",
        429
      );
    }
  }
}

/**
 * Sign a CastAdd with the account's app key and submit it to the hub.
 * Returns null when the user has not approved a signer yet.
 */
export async function publishCast(input: {
  fid: number;
  playerId: string;
  text: string;
  ip: string;
}): Promise<{ hash: string } | null> {
  const row = await getActiveSigner(input.fid);
  if (!row || row.player_id !== input.playerId) return null;
  if (row.permissions !== CAST_ONLY_PERMISSION) {
    throw new SignerHttpError("The active signer is not limited to casts.", 403);
  }

  const state = await readSignerState(input.fid, row.public_key as Hex);
  if (state === KEY_STATE_REMOVED) {
    await deleteSignerEnvelope(input.fid, row.generation).catch(() => undefined);
    await markSignerStatus({
      fid: input.fid,
      generation: row.generation,
      status: "revoked",
    });
    await writeSignerAudit({
      fid: input.fid,
      playerId: input.playerId,
      generation: row.generation,
      action: "revoke_detected",
      publicKey: row.public_key,
      result: "ok",
      detail: "key removed on Farcaster",
    });
    throw new SignerHttpError(
      "This signer was removed on Farcaster. Approve a new one to post again.",
      409
    );
  }
  if (state !== KEY_STATE_ADDED) {
    throw new SignerHttpError(
      "The signer is not active on the Farcaster KeyRegistry yet.",
      409
    );
  }

  await assertCastRate(input.fid, input.ip);

  const envelope = await getSignerEnvelope(input.fid, row.generation);
  if (!envelope) {
    throw new SignerHttpError(
      "The encrypted signer for this account is missing from the vault.",
      503
    );
  }

  let seed: Uint8Array | null = null;
  try {
    seed = await openCastSigner({
      fid: input.fid,
      generation: row.generation,
      envelope,
    });
    const signed = await signCastAdd({
      fid: input.fid,
      privateKey: seed,
      text: input.text,
    });
    await writeSignerAudit({
      fid: input.fid,
      playerId: input.playerId,
      generation: row.generation,
      action: "sign_cast",
      castText: input.text,
      messageHash: signed.hash,
      publicKey: row.public_key,
      result: "ok",
    });
    try {
      const submitted = await submitMessage(signed.encoded);
      const hash = submitted.hash || signed.hash;
      await writeSignerAudit({
        fid: input.fid,
        playerId: input.playerId,
        generation: row.generation,
        action: "hub_submit",
        castText: input.text,
        messageHash: hash,
        publicKey: row.public_key,
        result: "ok",
      });
      return { hash };
    } catch (error) {
      await writeSignerAudit({
        fid: input.fid,
        playerId: input.playerId,
        generation: row.generation,
        action: "hub_submit",
        castText: input.text,
        messageHash: signed.hash,
        publicKey: row.public_key,
        result: "error",
        detail: error instanceof Error ? error.message : "hub rejected the cast",
      });
      throw error;
    }
  } finally {
    wipe(seed);
  }
}
