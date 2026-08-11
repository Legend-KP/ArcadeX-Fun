import {
  CHAIN_REGISTRY,
  getChainKeyForEvmChainId,
} from "@/lib/chain-registry";
import type { FirebaseServiceAccountCreds } from "@/lib/firebase-admin";
import { VARA_CHAIN_ID } from "@/lib/vara-rewards";
import type { WalletEcosystem } from "@/lib/player-identity";
import type { ChainKey } from "@/types";

/** Chains that currently have dedicated Firebase RTDB projects. */
export const RTDB_CHAIN_KEYS = ["base", "avalanche", "vara"] as const;
export type RtdbChainKey = (typeof RTDB_CHAIN_KEYS)[number];

export type { FirebaseServiceAccountCreds };

export type RtdbConnection = {
  /** Human label for logs */
  label: string;
  databaseUrl: string;
  serviceAccount: FirebaseServiceAccountCreds | null;
  /** Legacy shared-only secret fallback */
  databaseSecret?: string;
};

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function normalizeDatabaseUrl(url: string, projectId: string): string {
  const explicit = url.replace(/\/$/, "");
  if (explicit) return explicit;
  if (!projectId) {
    throw new Error(
      "Realtime Database URL missing. Set FIREBASE_DATABASE_URL (shared) or the chain-specific FIREBASE_DATABASE_URL_*."
    );
  }
  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

function readServiceAccount(
  projectIdEnv: string,
  emailEnv: string,
  keyEnv: string
): FirebaseServiceAccountCreds | null {
  const projectId = env(projectIdEnv);
  const clientEmail = env(emailEnv);
  const privateKey = env(keyEnv).replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

/** Shared ArcadeX Fun RTDB (users, sparks, auth, general). */
export function getSharedRtdbConnection(): RtdbConnection {
  const serviceAccount = readServiceAccount(
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY"
  );
  // Prefer explicit shared project id; fall back to public client project id.
  const projectId =
    serviceAccount?.projectId ||
    env("FIREBASE_PROJECT_ID") ||
    env("NEXT_PUBLIC_FIREBASE_PROJECT_ID");

  return {
    label: "shared",
    databaseUrl: normalizeDatabaseUrl(env("FIREBASE_DATABASE_URL"), projectId),
    serviceAccount,
    databaseSecret: env("FIREBASE_DATABASE_SECRET") || undefined,
  };
}

function chainEnvSuffix(chainKey: RtdbChainKey): string {
  switch (chainKey) {
    case "base":
      return "BASE";
    case "avalanche":
      return "AVALANCHE";
    case "vara":
      return "VARA";
  }
}

/** Dedicated per-chain RTDB (leaderboards, contest boards, score tx guards). */
export function getChainRtdbConnection(chainKey: RtdbChainKey): RtdbConnection {
  const suffix = chainEnvSuffix(chainKey);
  const serviceAccount = readServiceAccount(
    `FIREBASE_PROJECT_ID_${suffix}`,
    `FIREBASE_CLIENT_EMAIL_${suffix}`,
    `FIREBASE_PRIVATE_KEY_${suffix}`
  );
  const databaseUrl = env(`FIREBASE_DATABASE_URL_${suffix}`);
  const projectId = serviceAccount?.projectId || env(`FIREBASE_PROJECT_ID_${suffix}`);

  if (!serviceAccount || !projectId) {
    throw new Error(
      `Chain RTDB credentials missing for ${chainKey}. Set FIREBASE_PROJECT_ID_${suffix}, FIREBASE_CLIENT_EMAIL_${suffix}, FIREBASE_PRIVATE_KEY_${suffix}, and FIREBASE_DATABASE_URL_${suffix}.`
    );
  }

  return {
    label: chainKey,
    databaseUrl: normalizeDatabaseUrl(databaseUrl, projectId),
    serviceAccount,
  };
}

export function isRtdbChainKey(value: string | null | undefined): value is RtdbChainKey {
  return (
    value === "base" || value === "avalanche" || value === "vara"
  );
}

/**
 * Map session / request chain to a dedicated RTDB chain key.
 * Returns null → use shared RTDB (no dedicated project for that network yet).
 */
export function resolveRtdbChainKey(opts: {
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
  chainKey?: ChainKey | null;
}): RtdbChainKey | null {
  if (opts.chainKey && isRtdbChainKey(opts.chainKey)) {
    return opts.chainKey;
  }

  if (opts.ecosystem === "vara") return "vara";
  if (
    typeof opts.chainId === "number" &&
    Number.isFinite(opts.chainId) &&
    opts.chainId === VARA_CHAIN_ID
  ) {
    return "vara";
  }

  if (typeof opts.chainId === "number" && Number.isFinite(opts.chainId)) {
    const key = getChainKeyForEvmChainId(opts.chainId);
    if (key && isRtdbChainKey(key)) return key;
  }

  // Default EVM sessions without chainId → Base (primary).
  if (opts.ecosystem === "evm" && (opts.chainId == null || opts.chainId === undefined)) {
    return "base";
  }

  return null;
}

/** Connection used for leaderboards / contest boards / score-submit tx guards. */
export function getLeaderboardRtdbConnection(opts: {
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
  chainKey?: ChainKey | null;
}): RtdbConnection {
  const chainKey = resolveRtdbChainKey(opts);
  if (chainKey) return getChainRtdbConnection(chainKey);
  return getSharedRtdbConnection();
}

/**
 * Connection for player economy data (users, sparks, per-user progress).
 * Base / Avalanche / Vara → dedicated chain RTDB; other networks → shared.
 */
export function getPlayerRtdbConnection(opts: {
  chainId?: number | null;
  ecosystem?: WalletEcosystem | null;
  chainKey?: ChainKey | null;
}): RtdbConnection {
  return getLeaderboardRtdbConnection(opts);
}

export function listConfiguredRtdbChainKeys(): RtdbChainKey[] {
  return RTDB_CHAIN_KEYS.filter((key) => {
    try {
      getChainRtdbConnection(key);
      return true;
    } catch {
      return false;
    }
  });
}

export function chainKeyToDefaultChainId(chainKey: RtdbChainKey): number | undefined {
  if (chainKey === "vara") return VARA_CHAIN_ID;
  return CHAIN_REGISTRY.find((entry) => entry.key === chainKey)?.chainId;
}
