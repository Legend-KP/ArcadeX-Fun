/**
 * Browser helpers that talk to Vara over HTTP JSON-RPC (no @gear-js/api).
 */
import { VARA_RPC_URL } from "@/lib/shop-vara";
import { toVaraActorId } from "@/lib/vara-address";
import {
  decodeVftBalanceOfReply,
  decodeVftDecimalsReply,
  encodeVftBalanceOfPayload,
  encodeVftDecimalsPayload,
  encodeVftTransferPayload,
  type HexString,
} from "@/lib/vara-vft-codec";

const HTTP_RPC = VARA_RPC_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
const ZERO_ORIGIN =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

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

export async function calculateVftTransferGas(params: {
  programId: string;
  fromAddress: string;
  toActorId: string;
  amount: bigint;
}): Promise<bigint> {
  const payload = encodeVftTransferPayload(params.toActorId, params.amount);
  const origin = toVaraActorId(params.fromAddress);
  // gear_calculateGasForHandle(source, dest, payload, value, allow_other_panics)
  const gasInfo = await rpc<{
    min_limit?: string | number;
    minLimit?: string | number;
  }>("gear_calculateGasForHandle", [
    origin,
    params.programId,
    payload,
    "0",
    true,
  ]);
  const raw = gasInfo.min_limit ?? gasInfo.minLimit ?? 50_000_000_000;
  const gas = BigInt(raw);
  return (gas * BigInt(12)) / BigInt(10);
}

async function calculateReplyForHandle(
  programId: string,
  payload: string
): Promise<string> {
  // gear_calculateReplyForHandle(origin, dest, payload, gasLimit, value, at?)
  const reply = await rpc<{ payload?: string }>("gear_calculateReplyForHandle", [
    ZERO_ORIGIN,
    programId,
    payload,
    250_000_000_000,
    "0",
  ]);
  if (!reply?.payload) {
    throw new Error("Empty Gear reply payload.");
  }
  return reply.payload;
}

export async function readVftBalance(
  programId: string,
  accountAddress: string
): Promise<bigint> {
  const actorId = toVaraActorId(accountAddress);
  const payload = encodeVftBalanceOfPayload(actorId);
  const replyPayload = await calculateReplyForHandle(programId, payload);
  return decodeVftBalanceOfReply(replyPayload);
}

export async function readVftDecimals(programId: string): Promise<number> {
  const payload = encodeVftDecimalsPayload();
  const replyPayload = await calculateReplyForHandle(programId, payload);
  return decodeVftDecimalsReply(replyPayload);
}

export function buildVftTransferPayload(
  toAddressOrActor: string,
  amount: bigint
): HexString {
  return encodeVftTransferPayload(toVaraActorId(toAddressOrActor), amount);
}
