/**
 * Client: send ArcadeXRewards CheckIn / Spin on Vara via an injected Substrate wallet.
 */
"use client";

import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { web3FromAddress } from "@polkadot/extension-dapp";
import { VARA_RPC_URL } from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import { resolveVaraSigningAddress } from "@/lib/vara-tx-hub-client";
import { varaWalletLabel } from "@/lib/vara-wallet-client";
import {
  assertVaraArcadeXRewardsConfigured,
  VARA_STREAK_CAMPAIGN_ID,
} from "@/lib/vara-rewards";
import {
  encodeRewardsCheckInPayload,
  encodeRewardsSpinPayload,
} from "@/lib/vara-rewards-codec";

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

async function calculateGas(params: {
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
  return (BigInt(raw) * BigInt(12)) / BigInt(10);
}

async function sendGearMessage(params: {
  signingAddress: string;
  programId: string;
  payload: string;
  onStatus?: (msg: string) => void;
}): Promise<string> {
  const injector = await web3FromAddress(params.signingAddress);
  if (!injector.signer) {
    throw new Error("Selected account cannot sign transactions.");
  }

  params.onStatus?.("Estimating gas…");
  const gasLimit = await calculateGas({
    programId: params.programId,
    fromAddress: params.signingAddress,
    payload: params.payload,
  });

  params.onStatus?.("Connecting to Vara…");
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const api = await ApiPromise.create({
    provider: new WsProvider(VARA_RPC_URL),
  });

  try {
    const extrinsic = api.tx.gear.sendMessage(
      params.programId,
      params.payload,
      gasLimit,
      0,
      true
    ) as SubmittableExtrinsic<"promise">;

    params.onStatus?.(
      `Approve the transaction in ${varaWalletLabel(injector.name)}…`
    );

    return await new Promise<string>((resolve, reject) => {
      extrinsic
        .signAndSend(
          params.signingAddress,
          { signer: injector.signer },
          (result) => {
            if (result.isError) {
              reject(new Error("Transaction failed."));
              return;
            }
            if (result.status.isInBlock || result.status.isFinalized) {
              if (result.dispatchError) {
                reject(new Error("Transaction failed on-chain."));
                return;
              }
              resolve(extrinsic.hash.toHex());
            }
          }
        )
        .catch(reject);
    });
  } finally {
    await api.disconnect();
  }
}

export async function checkInOnVara(params: {
  walletAddress: string;
  campaignId?: number;
  onStatus?: (msg: string) => void;
}): Promise<{ txHash: string }> {
  const programId = assertVaraArcadeXRewardsConfigured();
  const campaignId = params.campaignId ?? VARA_STREAK_CAMPAIGN_ID;
  const signingAddress = await resolveVaraSigningAddress(params.walletAddress);
  const payload = encodeRewardsCheckInPayload(campaignId);
  const txHash = await sendGearMessage({
    signingAddress,
    programId,
    payload,
    onStatus: params.onStatus,
  });
  return { txHash };
}

export async function spinOnVara(params: {
  walletAddress: string;
  campaignId: number;
  rewardMode: number;
  rewardAmount: bigint | number;
  nonce: number | bigint;
  deadline: number | bigint;
  signature: string;
  onStatus?: (msg: string) => void;
}): Promise<{ txHash: string }> {
  const programId = assertVaraArcadeXRewardsConfigured();
  const signingAddress = await resolveVaraSigningAddress(params.walletAddress);
  const payload = encodeRewardsSpinPayload({
    campaignId: params.campaignId,
    rewardMode: params.rewardMode,
    rewardAmount: params.rewardAmount,
    nonce: params.nonce,
    deadline: params.deadline,
    signature: params.signature,
  });
  const txHash = await sendGearMessage({
    signingAddress,
    programId,
    payload,
    onStatus: params.onStatus,
  });
  return { txHash };
}
