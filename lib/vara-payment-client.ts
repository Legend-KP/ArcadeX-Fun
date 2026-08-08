"use client";

import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { web3FromAddress } from "@polkadot/extension-dapp";
import { VARA_RPC_URL } from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import { resolveVaraSigningAddress } from "@/lib/vara-tx-hub-client";
import {
  getVaraPaymentProgramId,
  varaPaymentFee,
  varaPaymentTokenProgramId,
  type VaraPaymentKind,
  type VaraPaymentToken,
} from "@/lib/vara-payment";
import {
  encodePaymentPayPayload,
  encodeVftApprovePayload,
} from "@/lib/vara-payment-codec";

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

    params.onStatus?.("Approve the transaction in SubWallet…");

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

/**
 * Approve VFT spender = payment program, then call PayWithUsdt / PayWithUsdc.
 * Returns the **pay** extrinsic hash (use this for API credit).
 */
export async function payVaraPaymentProgram(params: {
  kind: VaraPaymentKind;
  token: VaraPaymentToken;
  fromAddress: string;
  onStatus?: (msg: string) => void;
}): Promise<{ payTxHash: string; approveTxHash: string; fee: bigint }> {
  const programId = getVaraPaymentProgramId(params.kind);
  const tokenProgramId = varaPaymentTokenProgramId(params.token);
  const fee = varaPaymentFee(params.kind);
  const signingAddress = await resolveVaraSigningAddress(params.fromAddress);

  params.onStatus?.("Approving token spend…");
  const approvePayload = encodeVftApprovePayload(programId, fee);
  const approveTxHash = await sendGearMessage({
    signingAddress,
    programId: tokenProgramId,
    payload: approvePayload,
    onStatus: params.onStatus,
  });

  params.onStatus?.("Paying fee…");
  const payMethod =
    params.token === "wusdt" ? "PayWithUsdt" : "PayWithUsdc";
  const payPayload = encodePaymentPayPayload(params.kind, payMethod);
  const payTxHash = await sendGearMessage({
    signingAddress,
    programId,
    payload: payPayload,
    onStatus: params.onStatus,
  });

  return { payTxHash, approveTxHash, fee };
}
