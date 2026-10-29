import { SignerHttpError } from "@/lib/farcaster/signer/errors";

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.CF_PAGES === "1" ||
    Boolean(process.env.CF_WORKER)
  );
}

function decode32(raw: string | undefined, label: string): Uint8Array {
  const value = raw?.trim() ?? "";
  if (!value) {
    throw new SignerHttpError(`${label} is not configured.`, 503);
  }

  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) {
      out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }

  try {
    const binary = atob(value);
    if (binary.length === 32) {
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i += 1) out[i] = binary.charCodeAt(i);
      return out;
    }
  } catch {
    // Not base64. The error below covers both shapes.
  }

  throw new SignerHttpError(
    `${label} must be 32 bytes, as 64 hex characters or standard base64.`,
    503
  );
}

/** Copy of the app seed. Callers wipe the returned bytes after HKDF. */
export function readAppSignerSeed(): Uint8Array {
  return decode32(process.env.FARCASTER_APP_SIGNER_SEED, "FARCASTER_APP_SIGNER_SEED");
}

/** Envelope KEK. Unused when FARCASTER_HSM_KEY_NAME selects an HSM binding. */
export function readEnvelopeKek(): Uint8Array {
  return decode32(process.env.FARCASTER_SIGNER_KEK, "FARCASTER_SIGNER_KEK");
}

export function hsmKeyName(): string | null {
  const name = process.env.FARCASTER_HSM_KEY_NAME?.trim();
  return name || null;
}

export function appFid(): number | null {
  const raw = process.env.FARCASTER_APP_FID?.trim();
  if (!raw) return null;
  const fid = Number(raw);
  if (!Number.isInteger(fid) || fid <= 0) {
    throw new SignerHttpError("FARCASTER_APP_FID must be a positive integer.", 503);
  }
  return fid;
}

export function appAccountPrivateKey(): `0x${string}` | null {
  const raw = process.env.FARCASTER_APP_ACCOUNT_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new SignerHttpError(
      "FARCASTER_APP_ACCOUNT_PRIVATE_KEY must be a 32-byte hex private key.",
      503
    );
  }
  return hex as `0x${string}`;
}

/**
 * Production refuses unsigned key requests so every signer is attributed to
 * the ArcadeX app fid. Development can add a raw key while that account is
 * still being registered.
 */
export function requireAppAttribution(): boolean {
  return isProductionRuntime();
}

export function hubUrl(): string {
  const configured = process.env.FARCASTER_HUB_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (isProductionRuntime()) {
    throw new SignerHttpError(
      "FARCASTER_HUB_URL is not configured. Set the Snapchain or hub HTTP base URL.",
      503
    );
  }
  return "https://hub.pinata.cloud";
}
