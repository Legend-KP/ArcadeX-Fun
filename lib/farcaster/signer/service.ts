import { getAddress, type Address, type Hex } from "viem";
import { readSessionFromCookies } from "@/lib/auth-session";
import {
  KEY_GATEWAY_ADDRESS,
  KEY_REGISTRY_ADDRESS,
} from "@/lib/farcaster/constants";
import { fetchSocialProfileByPlayerId } from "@/lib/farcaster/social-db";
import {
  addTypedData,
  approvalDeadline,
  buildKeyMetadata,
  hashManifest,
  removeTypedData,
  signAppKeyRequest,
  verifyAddSignature,
  verifyRemoveSignature,
  type AddTypedData,
  type RemoveTypedData,
} from "@/lib/farcaster/signer/approval";
import {
  encodeAddFor,
  encodeRemoveFor,
  KEY_STATE_ADDED,
  KEY_STATE_REMOVED,
  readAddNonce,
  readCustodyAddress,
  readRemoveNonce,
  readSignerState,
  readStorageUnitPrice,
} from "@/lib/farcaster/signer/chain";
import { sealCastSigner } from "@/lib/farcaster/signer/envelope";
import { SignerHttpError } from "@/lib/farcaster/signer/errors";
import {
  CAST_ONLY_PERMISSION,
  REVOKE_INSTRUCTIONS,
  signerGrantText,
} from "@/lib/farcaster/signer/permissions";
import {
  getActiveSigner,
  getLatestSigner,
  getSigner,
  insertSigner,
  listRetiredGenerations,
  markSignerActive,
  markSignerApproved,
  markSignerStatus,
  updatePendingSigner,
  writeSignerAudit,
  type SignerRow,
} from "@/lib/farcaster/signer/registry";
import {
  deleteSignerEnvelope,
  putSignerEnvelope,
} from "@/lib/farcaster/signer/vault";
import { checkRateLimit } from "@/lib/rate-limit";

const DAY_MS = 24 * 60 * 60 * 1000;

type Account = { fid: number; playerId: string };

async function requireAccount(): Promise<Account> {
  const session = await readSessionFromCookies();
  if (!session?.fid || !Number.isInteger(session.fid) || session.fid <= 0) {
    throw new SignerHttpError("Sign in with a Farcaster account first.", 401);
  }
  const profile = await fetchSocialProfileByPlayerId(session.playerId);
  if (!profile || profile.fid !== session.fid) {
    throw new SignerHttpError("This session is not linked to that fid.", 403);
  }
  return { fid: session.fid, playerId: session.playerId };
}

function asHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new SignerHttpError(`${label} is invalid.`, 400);
  }
  return value as Hex;
}

function asGeneration(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new SignerHttpError("Signer generation is invalid.", 400);
  }
  return value;
}

function publicSigner(row: SignerRow) {
  return {
    generation: row.generation,
    publicKey: row.public_key,
    status: row.status,
    deadline: row.deadline,
    manifest: row.manifest_text,
  };
}

async function expirePending(row: SignerRow) {
  await deleteSignerEnvelope(row.fid, row.generation).catch(() => undefined);
  await markSignerStatus({
    fid: row.fid,
    generation: row.generation,
    status: "expired",
  });
}

async function assertPrepareRate(fid: number) {
  const allowed = await checkRateLimit(
    `farcaster:signer:prepare:${fid}`,
    8,
    DAY_MS
  );
  if (!allowed) {
    throw new SignerHttpError(
      "Too many signer requests for this account today.",
      429
    );
  }
}

function approvalPayload(input: {
  fid: number;
  custody: Address;
  publicKey: Hex;
  generation: number;
  manifest: string;
  manifestHash: string;
  metadataType: number;
  metadata: Hex;
  nonce: bigint;
  deadline: bigint;
  typedData: AddTypedData;
}) {
  return {
    fid: input.fid,
    custodyAddress: input.custody,
    generation: input.generation,
    publicKey: input.publicKey,
    manifest: input.manifest,
    manifestHash: input.manifestHash,
    typedData: input.typedData,
    chainId: 10,
  };
}

async function refreshPending(row: SignerRow, custody: Address, playerId: string) {
  const deadline = approvalDeadline();
  const metadata = await buildKeyMetadata(row.public_key as Hex, deadline);
  const nonce = await readAddNonce(custody);
  const manifest = signerGrantText({
    fid: row.fid,
    publicKey: row.public_key,
    generation: row.generation,
    appFid: metadata.appFid,
  });
  const manifestHash = await hashManifest(manifest);
  await updatePendingSigner({
    fid: row.fid,
    generation: row.generation,
    nonce: nonce.toString(),
    custody,
    deadline: Number(deadline),
    manifestHash,
    manifestText: manifest,
    metadataType: metadata.metadataType,
    metadataHex: metadata.metadata,
  });
  await writeSignerAudit({
    fid: row.fid,
    playerId,
    generation: row.generation,
    action: "prepare",
    publicKey: row.public_key,
    result: "ok",
    detail: "refreshed pending approval",
  });
  const typedData = addTypedData({
    owner: custody,
    key: row.public_key as Hex,
    metadataType: metadata.metadataType,
    metadata: metadata.metadata,
    nonce,
    deadline,
  });
  return approvalPayload({
    fid: row.fid,
    custody,
    publicKey: row.public_key as Hex,
    generation: row.generation,
    manifest,
    manifestHash,
    metadataType: metadata.metadataType,
    metadata: metadata.metadata,
    nonce,
    deadline,
    typedData,
  });
}

/** Create or refresh the cast-only signer the user is about to approve. */
export async function prepareSignerApproval() {
  const account = await requireAccount();
  await assertPrepareRate(account.fid);
  const custody = await readCustodyAddress(account.fid);
  const latest = await getLatestSigner(account.fid);
  const now = Math.floor(Date.now() / 1000);

  if (latest?.status === "pending_approval") {
    if (latest.player_id !== account.playerId) {
      throw new SignerHttpError("This fid already has a signer request for another player.", 403);
    }
    if (latest.deadline > now) {
      return refreshPending(latest, custody, account.playerId);
    }
    await expirePending(latest);
  }

  const generation = (latest?.generation ?? 0) + 1;
  const deadline = approvalDeadline();
  const sealed = await sealCastSigner({ fid: account.fid, generation });
  const metadata = await buildKeyMetadata(sealed.publicKey, deadline);
  const nonce = await readAddNonce(custody);
  const manifest = signerGrantText({
    fid: account.fid,
    publicKey: sealed.publicKey,
    generation,
    appFid: metadata.appFid,
  });
  const manifestHash = await hashManifest(manifest);

  try {
    await putSignerEnvelope(account.fid, generation, sealed.envelope);
    await insertSigner({
      fid: account.fid,
      generation,
      player_id: account.playerId,
      public_key: sealed.publicKey,
      status: "pending_approval",
      permissions: CAST_ONLY_PERMISSION,
      manifest_hash: manifestHash,
      manifest_text: manifest,
      metadata_type: metadata.metadataType,
      metadata_hex: metadata.metadata,
      deadline: Number(deadline),
      nonce: nonce.toString(),
      custody_address: custody,
      approval_signature: null,
      onchain_tx: null,
      created_at: Date.now(),
      approved_at: null,
      activated_at: null,
      retired_at: null,
    });
  } catch (error) {
    await deleteSignerEnvelope(account.fid, generation).catch(() => undefined);
    throw error;
  }

  await writeSignerAudit({
    fid: account.fid,
    playerId: account.playerId,
    generation,
    action: "prepare",
    publicKey: sealed.publicKey,
    result: "ok",
  });

  return approvalPayload({
    fid: account.fid,
    custody,
    publicKey: sealed.publicKey,
    generation,
    manifest,
    manifestHash,
    metadataType: metadata.metadataType,
    metadata: metadata.metadata,
    nonce,
    deadline,
    typedData: addTypedData({
      owner: custody,
      key: sealed.publicKey,
      metadataType: metadata.metadataType,
      metadata: metadata.metadata,
      nonce,
      deadline,
    }),
  });
}

export async function approveSigner(input: {
  generation: number;
  signature: string;
}) {
  const account = await requireAccount();
  const generation = asGeneration(input.generation);
  const signature = asHex(input.signature, "Signature");
  const row = await getSigner(account.fid, generation);
  if (!row || row.player_id !== account.playerId) {
    throw new SignerHttpError("No pending signer matches this account.", 404);
  }
  if (row.status !== "pending_approval") {
    throw new SignerHttpError("This signer is not waiting for approval.", 409);
  }
  const now = Math.floor(Date.now() / 1000);
  if (row.deadline <= now) {
    await expirePending(row);
    throw new SignerHttpError("This approval expired. Review the request again.", 409);
  }

  const custody = await readCustodyAddress(account.fid);
  if (getAddress(row.custody_address) !== custody) {
    throw new SignerHttpError(
      "The fid custody address changed. Review the request again.",
      409
    );
  }
  const nonce = await readAddNonce(custody);
  if (nonce.toString() !== row.nonce) {
    throw new SignerHttpError(
      "The KeyGateway nonce changed. Review the request again.",
      409
    );
  }

  const valid = await verifyAddSignature({
    owner: custody,
    key: row.public_key as Hex,
    metadataType: row.metadata_type,
    metadata: row.metadata_hex as Hex,
    nonce,
    deadline: BigInt(row.deadline),
    signature,
  });
  if (!valid) {
    await writeSignerAudit({
      fid: account.fid,
      playerId: account.playerId,
      generation,
      action: "approve",
      publicKey: row.public_key,
      result: "error",
      detail: "signature did not match the shown grant",
    });
    throw new SignerHttpError(
      "The signature does not match the signer request ArcadeX showed you.",
      400
    );
  }

  await markSignerApproved({
    fid: account.fid,
    generation,
  });
  const price = await readStorageUnitPrice();
  const data = encodeAddFor({
    fidOwner: custody,
    key: row.public_key as Hex,
    metadataType: row.metadata_type,
    metadata: row.metadata_hex as Hex,
    deadline: BigInt(row.deadline),
    signature,
  });
  await writeSignerAudit({
    fid: account.fid,
    playerId: account.playerId,
    generation,
    action: "approve",
    publicKey: row.public_key,
    result: "ok",
  });

  return {
    generation,
    publicKey: row.public_key,
    transaction: {
      chainId: 10,
      to: KEY_GATEWAY_ADDRESS,
      data,
      value: `0x${price.toString(16)}`,
    },
  };
}

export async function confirmSigner(input: {
  generation: number;
  txHash?: string;
}) {
  const account = await requireAccount();
  const generation = asGeneration(input.generation);
  const row = await getSigner(account.fid, generation);
  if (!row || row.player_id !== account.playerId) {
    throw new SignerHttpError("No signer matches this account.", 404);
  }
  const txHash = input.txHash ? asHex(input.txHash, "Transaction hash") : null;
  if (txHash && txHash.length !== 66) {
    throw new SignerHttpError("Transaction hash is invalid.", 400);
  }

  const state = await readSignerState(account.fid, row.public_key as Hex);
  if (state !== KEY_STATE_ADDED) {
    throw new SignerHttpError(
      "The signer is not on the KeyRegistry yet. Submit the Optimism transaction, then try again.",
      409
    );
  }

  await markSignerActive({
    fid: account.fid,
    generation,
    txHash,
  });
  const retired = await listRetiredGenerations(account.fid);
  for (const oldGeneration of retired) {
    if (oldGeneration === generation) continue;
    await deleteSignerEnvelope(account.fid, oldGeneration).catch(() => undefined);
  }
  await writeSignerAudit({
    fid: account.fid,
    playerId: account.playerId,
    generation,
    action: "confirm",
    publicKey: row.public_key,
    result: "ok",
    detail: txHash,
  });

  return {
    status: "active" as const,
    generation,
    publicKey: row.public_key,
    revokeInstructions: REVOKE_INSTRUCTIONS,
  };
}

export async function rotateSigner() {
  const account = await requireAccount();
  const allowed = await checkRateLimit(
    `farcaster:signer:rotate:${account.fid}`,
    3,
    DAY_MS
  );
  if (!allowed) {
    throw new SignerHttpError("This account can rotate a signer 3 times a day.", 429);
  }
  const active = await getActiveSigner(account.fid);
  if (!active) {
    throw new SignerHttpError("Approve a signer before rotating it.", 409);
  }
  const prepared = await prepareSignerApproval();
  await writeSignerAudit({
    fid: account.fid,
    playerId: account.playerId,
    generation: active.generation,
    action: "rotate",
    publicKey: active.public_key,
    result: "ok",
    detail: `next generation ${prepared.generation}`,
  });
  return {
    ...prepared,
    previousPublicKey: active.public_key,
    revokeInstructions: REVOKE_INSTRUCTIONS,
  };
}

export async function prepareSignerRevoke(generation: number) {
  const account = await requireAccount();
  const row = await getSigner(account.fid, generation);
  if (!row || row.player_id !== account.playerId) {
    throw new SignerHttpError("No signer matches this account.", 404);
  }
  if (row.status === "pending_approval") {
    await expirePending(row);
    await writeSignerAudit({
      fid: account.fid,
      playerId: account.playerId,
      generation,
      action: "revoke",
      publicKey: row.public_key,
      result: "ok",
      detail: "cancelled before it was added onchain",
    });
    return { cancelled: true as const, generation };
  }
  if (row.status !== "active" && row.status !== "retired") {
    throw new SignerHttpError("This signer is already inactive.", 409);
  }

  const custody = await readCustodyAddress(account.fid);
  const nonce = await readRemoveNonce(custody);
  const deadline = approvalDeadline();
  await writeSignerAudit({
    fid: account.fid,
    playerId: account.playerId,
    generation,
    action: "revoke_prepare",
    publicKey: row.public_key,
    result: "ok",
  });
  return {
    cancelled: false as const,
    generation,
    publicKey: row.public_key,
    custodyAddress: custody,
    typedData: removeTypedData({
      owner: custody,
      key: row.public_key as Hex,
      nonce,
      deadline,
    }),
    revokeInstructions: REVOKE_INSTRUCTIONS,
  };
}

export async function submitSignerRevoke(input: {
  generation: number;
  signature: string;
  nonce: string;
  deadline: string;
}) {
  const account = await requireAccount();
  const generation = asGeneration(input.generation);
  const signature = asHex(input.signature, "Signature");
  const row = await getSigner(account.fid, generation);
  if (!row || row.player_id !== account.playerId) {
    throw new SignerHttpError("No signer matches this account.", 404);
  }
  if (row.status !== "active" && row.status !== "retired") {
    throw new SignerHttpError("This signer is not onchain.", 409);
  }
  if (!/^\d+$/.test(input.nonce) || !/^\d+$/.test(input.deadline)) {
    throw new SignerHttpError("Revoke nonce or deadline is invalid.", 400);
  }

  const custody = await readCustodyAddress(account.fid);
  const nonce = await readRemoveNonce(custody);
  const deadline = BigInt(input.deadline);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (
    nonce.toString() !== input.nonce ||
    deadline <= now ||
    deadline > now + BigInt(60 * 60)
  ) {
    throw new SignerHttpError("This revoke request is stale. Start it again.", 409);
  }

  const valid = await verifyRemoveSignature({
    owner: custody,
    key: row.public_key as Hex,
    nonce,
    deadline,
    signature,
  });
  if (!valid) {
    await writeSignerAudit({
      fid: account.fid,
      playerId: account.playerId,
      generation,
      action: "revoke",
      publicKey: row.public_key,
      result: "error",
      detail: "signature did not match",
    });
    throw new SignerHttpError(
      "The signature does not match the revoke request for this key.",
      400
    );
  }

  await writeSignerAudit({
    fid: account.fid,
    playerId: account.playerId,
    generation,
    action: "revoke_sign",
    publicKey: row.public_key,
    result: "ok",
  });

  return {
    generation,
    publicKey: row.public_key,
    transaction: {
      chainId: 10,
      to: KEY_REGISTRY_ADDRESS,
      data: encodeRemoveFor({
        fidOwner: custody,
        key: row.public_key as Hex,
        deadline,
        signature,
      }),
      value: "0x0",
    },
  };
}

export async function confirmSignerRevoke(input: {
  generation: number;
  txHash?: string;
}) {
  const account = await requireAccount();
  const generation = asGeneration(input.generation);
  const row = await getSigner(account.fid, generation);
  if (!row || row.player_id !== account.playerId) {
    throw new SignerHttpError("No signer matches this account.", 404);
  }
  const state = await readSignerState(account.fid, row.public_key as Hex);
  if (state !== KEY_STATE_REMOVED) {
    throw new SignerHttpError(
      "The key is still on the KeyRegistry. Finish the remove transaction, or remove it in Farcaster settings.",
      409
    );
  }
  await deleteSignerEnvelope(account.fid, generation).catch(() => undefined);
  await markSignerStatus({
    fid: account.fid,
    generation,
    status: "revoked",
  });
  const txHash = input.txHash ? asHex(input.txHash, "Transaction hash") : null;
  await writeSignerAudit({
    fid: account.fid,
    playerId: account.playerId,
    generation,
    action: "revoke",
    publicKey: row.public_key,
    result: "ok",
    detail: txHash,
  });
  return { status: "revoked" as const, generation, publicKey: row.public_key };
}

export async function signerStatus() {
  const account = await requireAccount();
  let active = await getActiveSigner(account.fid);
  if (active && active.player_id !== account.playerId) {
    active = null;
  }
  if (active) {
    try {
      const state = await readSignerState(account.fid, active.public_key as Hex);
      if (state === KEY_STATE_REMOVED) {
        await deleteSignerEnvelope(account.fid, active.generation).catch(() => undefined);
        await markSignerStatus({
          fid: account.fid,
          generation: active.generation,
          status: "revoked",
        });
        await writeSignerAudit({
          fid: account.fid,
          playerId: account.playerId,
          generation: active.generation,
          action: "revoke_detected",
          publicKey: active.public_key,
          result: "ok",
        });
        active = null;
      }
    } catch {
      // Status still shows the local signer if Optimism cannot be read.
    }
  }

  const latest = await getLatestSigner(account.fid);
  let pending: SignerRow | null = null;
  if (latest?.status === "pending_approval") {
    const now = Math.floor(Date.now() / 1000);
    if (latest.deadline <= now) {
      await expirePending(latest);
    } else {
      pending = latest;
    }
  }

  return {
    fid: account.fid,
    permission: CAST_ONLY_PERMISSION,
    revokeInstructions: REVOKE_INSTRUCTIONS,
    active: active ? publicSigner(active) : null,
    pending: pending ? publicSigner(pending) : null,
  };
}

const FARCASTER_CLIENT_API = "https://api.farcaster.xyz";

type FarcasterSignedKeyRequest = {
  token?: string;
  deeplinkUrl?: string;
  key?: string;
  state?: string;
  userFid?: number;
};

function isDeeplinkToken(value: string): boolean {
  return /^0x[0-9a-fA-F]{8,80}$/.test(value);
}

async function readFarcasterSignedKeyRequest(
  token: string
): Promise<FarcasterSignedKeyRequest> {
  const response = await fetch(
    `${FARCASTER_CLIENT_API}/v2/signed-key-request?token=${encodeURIComponent(token)}`
  );
  const body = (await response.json().catch(() => null)) as {
    result?: { signedKeyRequest?: FarcasterSignedKeyRequest };
  } | null;
  const request = body?.result?.signedKeyRequest;
  if (!response.ok || !request) {
    throw new SignerHttpError("Farcaster could not find that approval.", 502);
  }
  return request;
}

/**
 * Ask the Farcaster app to approve a pending signer.
 * The phone holds the custody key and submits the Optimism transaction.
 */
export async function createSignerDeeplink(generationInput: number) {
  const account = await requireAccount();
  const generation = asGeneration(generationInput);
  const allowed = await checkRateLimit(
    `farcaster:signer:deeplink:${account.fid}`,
    12,
    60 * 60 * 1000
  );
  if (!allowed) {
    throw new SignerHttpError("Too many Farcaster approval links. Try again later.", 429);
  }
  const row = await getSigner(account.fid, generation);
  if (!row || row.player_id !== account.playerId || row.status !== "pending_approval") {
    throw new SignerHttpError("Review the signer before opening Farcaster.", 409);
  }
  const now = Math.floor(Date.now() / 1000);
  if (row.deadline <= now) {
    throw new SignerHttpError("This approval expired. Review it again.", 409);
  }

  const signed = await signAppKeyRequest(row.public_key as Hex, BigInt(row.deadline));
  const response = await fetch(`${FARCASTER_CLIENT_API}/v2/signed-key-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: row.public_key,
      requestFid: signed.requestFid,
      signature: signed.signature,
      deadline: row.deadline,
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    result?: { signedKeyRequest?: FarcasterSignedKeyRequest };
    errors?: { message?: string }[];
  } | null;
  const request = body?.result?.signedKeyRequest;
  if (
    !response.ok ||
    !request?.token ||
    !request.deeplinkUrl ||
    !isDeeplinkToken(request.token) ||
    !request.deeplinkUrl.startsWith("farcaster://signed-key-request?")
  ) {
    throw new SignerHttpError(
      "Farcaster did not return an approval link. Check the app fid and app account key.",
      502
    );
  }

  await writeSignerAudit({
    fid: account.fid,
    playerId: account.playerId,
    generation,
    action: "deeplink",
    publicKey: row.public_key,
    result: "ok",
  });

  return {
    token: request.token,
    deeplinkUrl: request.deeplinkUrl,
    state: request.state ?? "pending",
    generation,
  };
}

/** Poll the Farcaster app approval. Confirms the signer once Optimism shows it. */
export async function pollSignerDeeplink(token: string, generationInput: number) {
  const account = await requireAccount();
  const generation = asGeneration(generationInput);
  if (!isDeeplinkToken(token)) {
    throw new SignerHttpError("Approval token is invalid.", 400);
  }
  const row = await getSigner(account.fid, generation);
  if (!row || row.player_id !== account.playerId) {
    throw new SignerHttpError("No signer matches this account.", 404);
  }
  const remote = await readFarcasterSignedKeyRequest(token);
  if (
    remote.key &&
    remote.key.toLowerCase() !== row.public_key.toLowerCase()
  ) {
    throw new SignerHttpError("This approval is for a different signer.", 409);
  }
  if (row.status === "active") {
    return { state: "completed" as const, confirmed: true, generation };
  }
  if (remote.state !== "completed") {
    return {
      state: remote.state === "approved" ? ("approved" as const) : ("pending" as const),
      confirmed: false,
      generation,
      deeplinkUrl: remote.deeplinkUrl,
    };
  }
  try {
    await confirmSigner({ generation });
    return { state: "completed" as const, confirmed: true, generation };
  } catch (error) {
    if (error instanceof SignerHttpError && error.status === 409) {
      return { state: "approved" as const, confirmed: false, generation };
    }
    throw error;
  }
}
