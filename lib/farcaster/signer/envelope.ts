import { ed25519 } from "@noble/curves/ed25519";
import { bytesToHex, type Hex } from "viem";
import {
  hsmKeyName,
  readAppSignerSeed,
  readEnvelopeKek,
} from "@/lib/farcaster/signer/config";
import { SignerHttpError } from "@/lib/farcaster/signer/errors";
import { getWorkerEnv, type FarcasterHsmBinding } from "@/lib/worker-env";

const DERIVE_INFO = "arcadex.farcaster.cast-signer.v1";

export type SignerEnvelope = {
  v: 1;
  alg: "A256GCM";
  kekId: string;
  aad: string;
  dekIv: string;
  wrappedDek: string;
  iv: string;
  ciphertext: string;
};

function wipe(bytes: Uint8Array | null | undefined) {
  bytes?.fill(0);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

export function signerAad(fid: number, generation: number): string {
  return `fid:${fid}|gen:${generation}|scope:cast_add|v1`;
}

async function importAes(keyBytes: Uint8Array, usages: KeyUsage[]) {
  return crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, usages);
}

async function aesEncrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const key = await importAes(keyBytes, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
    },
    key,
    toArrayBuffer(plaintext)
  );
  return new Uint8Array(ciphertext);
}

async function aesDecrypt(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const key = await importAes(keyBytes, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
    },
    key,
    toArrayBuffer(ciphertext)
  );
  return new Uint8Array(plaintext);
}

async function deriveCastSeed(
  appSeed: Uint8Array,
  salt: Uint8Array,
  fid: number,
  generation: number
): Promise<Uint8Array> {
  const info = new TextEncoder().encode(
    `${DERIVE_INFO}|fid:${fid}|gen:${generation}|scope:cast_add`
  );
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(appSeed), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info),
    },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function getHsm(): Promise<{ binding: FarcasterHsmBinding; keyName: string } | null> {
  const keyName = hsmKeyName();
  if (!keyName) return null;
  const env = await getWorkerEnv();
  const binding = env?.FARCASTER_HSM;
  if (!binding) {
    throw new SignerHttpError(
      "FARCASTER_HSM_KEY_NAME is set, but the FARCASTER_HSM worker binding is not provisioned. Refusing to wrap signer keys with the env key instead.",
      503
    );
  }
  return { binding, keyName };
}

async function wrapDek(dek: Uint8Array, aad: string): Promise<{
  kekId: string;
  dekIv: string;
  wrappedDek: string;
}> {
  const hsm = await getHsm();
  if (hsm) {
    const wrapped = await hsm.binding.wrap({
      keyName: hsm.keyName,
      dekB64: toBase64(dek),
      aad,
    });
    return {
      kekId: `hsm:${hsm.keyName}`,
      dekIv: wrapped.ivB64,
      wrappedDek: wrapped.wrappedDekB64,
    };
  }

  const kek = readEnvelopeKek();
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await aesEncrypt(kek, iv, dek, new TextEncoder().encode(aad));
    return {
      kekId: "env:FARCASTER_SIGNER_KEK",
      dekIv: toBase64(iv),
      wrappedDek: toBase64(wrapped),
    };
  } finally {
    wipe(kek);
  }
}

async function unwrapDek(envelope: SignerEnvelope): Promise<Uint8Array> {
  if (envelope.kekId.startsWith("hsm:")) {
    const keyName = envelope.kekId.slice("hsm:".length);
    const env = await getWorkerEnv();
    const binding = env?.FARCASTER_HSM;
    if (!binding) {
      throw new SignerHttpError(
        "This signer was wrapped by an HSM, and the FARCASTER_HSM binding is not available.",
        503
      );
    }
    const unwrapped = await binding.unwrap({
      keyName,
      ivB64: envelope.dekIv,
      wrappedDekB64: envelope.wrappedDek,
      aad: envelope.aad,
    });
    const dek = fromBase64(unwrapped.dekB64);
    if (dek.length !== 32) {
      wipe(dek);
      throw new SignerHttpError("HSM returned a data key that is not 32 bytes.", 503);
    }
    return dek;
  }

  const kek = readEnvelopeKek();
  try {
    return await aesDecrypt(
      kek,
      fromBase64(envelope.dekIv),
      fromBase64(envelope.wrappedDek),
      new TextEncoder().encode(envelope.aad)
    );
  } finally {
    wipe(kek);
  }
}

/**
 * Derive a cast-only Ed25519 seed for this fid and generation, then seal it.
 * The app seed and the per-user seed are wiped before this returns.
 * The random salt stays inside the ciphertext, so the app seed alone cannot
 * recreate the key.
 */
export async function sealCastSigner(input: {
  fid: number;
  generation: number;
}): Promise<{ publicKey: Hex; envelope: SignerEnvelope }> {
  const aad = signerAad(input.fid, input.generation);
  const aadBytes = new TextEncoder().encode(aad);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const appSeed = readAppSignerSeed();
  let seed: Uint8Array | null = null;
  let dek: Uint8Array | null = null;
  try {
    seed = await deriveCastSeed(appSeed, salt, input.fid, input.generation);
    const payload = new Uint8Array(48);
    payload.set(salt, 0);
    payload.set(seed, 16);
    dek = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await aesEncrypt(dek, iv, payload, aadBytes);
    const wrapped = await wrapDek(dek, aad);
    wipe(payload);
    const publicKey = bytesToHex(ed25519.getPublicKey(seed));
    return {
      publicKey,
      envelope: {
        v: 1,
        alg: "A256GCM",
        kekId: wrapped.kekId,
        aad,
        dekIv: wrapped.dekIv,
        wrappedDek: wrapped.wrappedDek,
        iv: toBase64(iv),
        ciphertext: toBase64(ciphertext),
      },
    };
  } finally {
    wipe(appSeed);
    wipe(seed);
    wipe(dek);
    wipe(salt);
  }
}

/**
 * Open a sealed signer and check it still matches HKDF(app seed, fid, generation).
 * Caller wipes the returned seed.
 */
export async function openCastSigner(input: {
  fid: number;
  generation: number;
  envelope: SignerEnvelope;
}): Promise<Uint8Array> {
  const expectedAad = signerAad(input.fid, input.generation);
  if (input.envelope.v !== 1 || input.envelope.aad !== expectedAad) {
    throw new SignerHttpError("Signer envelope does not match this account.", 409);
  }

  const dek = await unwrapDek(input.envelope);
  let payload: Uint8Array | null = null;
  let again: Uint8Array | null = null;
  const appSeed = readAppSignerSeed();
  try {
    payload = await aesDecrypt(
      dek,
      fromBase64(input.envelope.iv),
      fromBase64(input.envelope.ciphertext),
      new TextEncoder().encode(expectedAad)
    );
    if (payload.length !== 48) {
      throw new SignerHttpError("Signer envelope payload is invalid.", 503);
    }
    const salt = payload.subarray(0, 16);
    const seed = payload.subarray(16, 48);
    again = await deriveCastSeed(appSeed, salt, input.fid, input.generation);
    if (!timingSafeEqual(again, seed)) {
      throw new SignerHttpError(
        "Signer envelope does not match the app key for this fid.",
        409
      );
    }
    const copy = new Uint8Array(32);
    copy.set(seed);
    return copy;
  } finally {
    wipe(dek);
    wipe(payload);
    wipe(again);
    wipe(appSeed);
  }
}
