"use client";

import type { SubmittableExtrinsic } from "@polkadot/api/types";
import {
  web3Accounts,
  web3Enable,
  web3FromAddress,
} from "@polkadot/extension-dapp";
import {
  assertVaraTxHubConfigured,
  playPurpose,
  VARA_RPC_URL,
} from "@/lib/vara-tx-hub";
import { encodeTxHubSignInPayload } from "@/lib/vara-tx-hub-codec";
import {
  ensureVaraCryptoReady,
  toVaraActorId,
} from "@/lib/vara-address";

const VARA_APP_NAME = "ArcadeX";
const HTTP_RPC = VARA_RPC_URL.replace(/^wss:/, "https:").replace(
  /^ws:/,
  "http:"
);
const SIGN_IN_TIMEOUT_MS = 120_000;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(HTTP_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Vara RPC HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (json.error) throw new Error(json.error.message || "Vara RPC error");
  return json.result as T;
}

/**
 * SubWallet keeps accounts under the SS58 it injected (often prefix 42).
 * Session/playerId may be re-encoded to Vara prefix 137 — match by ActorId.
 */
export async function resolveVaraSigningAddress(
  preferredAddress: string
): Promise<string> {
  await ensureVaraCryptoReady();
  const extensions = await web3Enable(VARA_APP_NAME);
  if (!extensions.length) {
    throw new Error(
      "SubWallet not found. Unlock SubWallet and allow ArcadeX, then try again."
    );
  }

  const accounts = await web3Accounts();
  if (!accounts.length) {
    throw new Error("No SubWallet accounts available.");
  }

  const target = toVaraActorId(preferredAddress);
  const match = accounts.find((account) => {
    try {
      return toVaraActorId(account.address) === target;
    } catch {
      return false;
    }
  });

  if (!match) {
    throw new Error(
      "Connected Vara account not found in SubWallet. Select that account in SubWallet, then try again."
    );
  }

  return match.address;
}

async function calculateSignInGas(params: {
  programId: string;
  fromAddress: string;
  payload: string;
}): Promise<bigint> {
  const origin = toVaraActorId(params.fromAddress);
  const gasInfo = await rpc<{
    min_limit?: string | number;
    minLimit?: string | number;
  }>("gear_calculateGasForHandle", [
    origin,
    params.programId,
    params.payload,
    "0",
    true,
  ]);
  const raw = gasInfo.min_limit ?? gasInfo.minLimit ?? 50_000_000_000;
  const gas = BigInt(raw);
  return (gas * BigInt(12)) / BigInt(10);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Free on-chain sign_in for Start Game (play purpose).
 * Returns extrinsic hash.
 */
export async function signInOnVaraTxHub(params: {
  fromAddress: string;
  gameId: string;
  onStatus?: (message: string) => void;
}): Promise<string> {
  const programId = assertVaraTxHubConfigured();
  params.onStatus?.("Connecting SubWallet…");

  const signingAddress = await resolveVaraSigningAddress(params.fromAddress);
  const injector = await web3FromAddress(signingAddress);
  if (!injector.signer) {
    throw new Error("Selected account cannot sign transactions.");
  }

  const purpose = playPurpose(params.gameId);
  const payload = encodeTxHubSignInPayload(purpose);

  params.onStatus?.("Estimating gas…");
  const gasLimit = await calculateSignInGas({
    programId,
    fromAddress: signingAddress,
    payload,
  });

  params.onStatus?.("Connecting to Vara…");
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const api = await withTimeout(
    ApiPromise.create({ provider: new WsProvider(VARA_RPC_URL) }),
    30_000,
    "Timed out connecting to Vara RPC. Check your network and try again."
  );

  try {
    const extrinsic = api.tx.gear.sendMessage(
      programId,
      payload,
      gasLimit,
      0,
      true
    ) as SubmittableExtrinsic<"promise">;

    params.onStatus?.("Approve the free sign-in in SubWallet…");

    const txHash = await withTimeout(
      new Promise<string>((resolve, reject) => {
        extrinsic
          .signAndSend(
            signingAddress,
            { signer: injector.signer },
            (result) => {
              if (result.isError) {
                reject(new Error("Sign-in transaction failed."));
                return;
              }
              if (result.status.isInBlock || result.status.isFinalized) {
                if (result.dispatchError) {
                  reject(new Error("Sign-in transaction failed on-chain."));
                  return;
                }
                resolve(extrinsic.hash.toHex());
              }
            }
          )
          .catch(reject);
      }),
      SIGN_IN_TIMEOUT_MS,
      "Timed out waiting for SubWallet. Open SubWallet, approve the transaction, then try again."
    );

    return txHash;
  } finally {
    await api.disconnect();
  }
}
