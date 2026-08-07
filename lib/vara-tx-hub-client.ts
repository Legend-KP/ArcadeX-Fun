"use client";

import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { web3Enable, web3FromAddress } from "@polkadot/extension-dapp";
import {
  assertVaraTxHubConfigured,
  playPurpose,
  VARA_RPC_URL,
} from "@/lib/vara-tx-hub";
import { encodeTxHubSignInPayload } from "@/lib/vara-tx-hub-codec";
import { toVaraActorId } from "@/lib/vara-address";

const VARA_APP_NAME = "ArcadeX";
const HTTP_RPC = VARA_RPC_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

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

/**
 * Free on-chain sign_in for Start Game (play purpose).
 * Returns extrinsic hash.
 */
export async function signInOnVaraTxHub(params: {
  fromAddress: string;
  gameId: string;
}): Promise<string> {
  const programId = assertVaraTxHubConfigured();

  const extensions = await web3Enable(VARA_APP_NAME);
  if (!extensions.length) {
    throw new Error("Polkadot.js extension not found.");
  }

  const injector = await web3FromAddress(params.fromAddress);
  if (!injector.signer) {
    throw new Error("Selected account cannot sign transactions.");
  }

  const purpose = playPurpose(params.gameId);
  const payload = encodeTxHubSignInPayload(purpose);
  const gasLimit = await calculateSignInGas({
    programId,
    fromAddress: params.fromAddress,
    payload,
  });

  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const api = await ApiPromise.create({
    provider: new WsProvider(VARA_RPC_URL),
  });

  try {
    const extrinsic = api.tx.gear.sendMessage(
      programId,
      payload,
      gasLimit,
      0,
      true
    ) as SubmittableExtrinsic<"promise">;

    const txHash = await new Promise<string>((resolve, reject) => {
      extrinsic
        .signAndSend(
          params.fromAddress,
          { signer: injector.signer },
          (result) => {
            if (result.status.isInBlock || result.status.isFinalized) {
              if (result.dispatchError) {
                reject(new Error("Sign-in transaction failed."));
                return;
              }
              resolve(extrinsic.hash.toHex());
            }
          }
        )
        .catch(reject);
    });

    return txHash;
  } finally {
    await api.disconnect();
  }
}
