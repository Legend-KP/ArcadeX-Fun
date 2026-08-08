/**
 * Approve VFT + PayWithUsdt/PayWithUsdc via SubWallet (browser only).
 */
"use client";

import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { web3FromAddress } from "@polkadot/extension-dapp";
import { VARA_RPC_URL } from "@/lib/shop-vara";
import { ensureVaraCryptoReady, toVaraActorId } from "@/lib/vara-address";
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
const DEFAULT_GAS = BigInt(250_000_000_000);
const TX_TIMEOUT_MS = 120_000;

function formatUnknownError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object") {
    const record = err as { message?: unknown; toString?: () => string };
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
  }
  return fallback;
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

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(HTTP_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Vara RPC HTTP ${res.status}`);
  const json = (await res.json()) as {
    result?: T;
    error?: { message?: string; data?: string };
  };
  if (json.error) {
    throw new Error(
      json.error.message || json.error.data || "Vara RPC error"
    );
  }
  if (json.result === undefined || json.result === null) {
    throw new Error(`Vara RPC returned empty result for ${method}.`);
  }
  return json.result;
}

async function calculateGas(params: {
  programId: string;
  fromAddress: string;
  payload: string;
}): Promise<string> {
  try {
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
    const raw = gasInfo?.min_limit ?? gasInfo?.minLimit;
    const gas =
      raw === undefined || raw === null
        ? DEFAULT_GAS
        : (BigInt(raw) * BigInt(12)) / BigInt(10);
    return gas.toString();
  } catch (err) {
    // Still allow SubWallet to open — chain will reject if gas is truly too low.
    console.warn("[ArcadeX] gas estimate failed, using default:", err);
    return DEFAULT_GAS.toString();
  }
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
  const api = await withTimeout(
    ApiPromise.create({ provider: new WsProvider(VARA_RPC_URL) }),
    30_000,
    "Timed out connecting to Vara RPC. Check your network and try again."
  );

  try {
    if (!api.tx?.gear?.sendMessage) {
      throw new Error(
        "Vara gear pallet unavailable from RPC metadata. Try again in a moment."
      );
    }

    const extrinsic = api.tx.gear.sendMessage(
      params.programId,
      params.payload,
      gasLimit,
      0,
      true
    ) as SubmittableExtrinsic<"promise">;

    params.onStatus?.("Approve the transaction in SubWallet…");

    return await withTimeout(
      new Promise<string>((resolve, reject) => {
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
          .catch((err: unknown) => {
            reject(
              new Error(
                formatUnknownError(
                  err,
                  "SubWallet rejected the transaction or it failed."
                )
              )
            );
          });
      }),
      TX_TIMEOUT_MS,
      "Timed out waiting for SubWallet. Unlock SubWallet, approve the transaction, then try again."
    );
  } finally {
    await api.disconnect().catch(() => undefined);
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
  await ensureVaraCryptoReady();

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
