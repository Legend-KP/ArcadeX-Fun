/**
 * Browser helpers that talk to Vara over HTTP JSON-RPC (no @gear-js/api).
 */
import { toVaraActorId } from "@/lib/vara-address";
import { varaJsonRpc } from "@/lib/vara-rpc-http";
import {
  decodeVftBalanceOfReply,
  decodeVftDecimalsReply,
  encodeVftBalanceOfPayload,
  encodeVftDecimalsPayload,
  encodeVftTransferPayload,
  type HexString,
} from "@/lib/vara-vft-codec";

const ZERO_ORIGIN =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export async function calculateVftTransferGas(params: {
  programId: string;
  fromAddress: string;
  toActorId: string;
  amount: bigint;
}): Promise<bigint> {
  const payload = encodeVftTransferPayload(params.toActorId, params.amount);
  const origin = toVaraActorId(params.fromAddress);
  // gear_calculateGasForHandle(source, dest, payload, value, allow_other_panics)
  const gasInfo = await varaJsonRpc<{
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
  const reply = await varaJsonRpc<{ payload?: string }>(
    "gear_calculateReplyForHandle",
    [ZERO_ORIGIN, programId, payload, 250_000_000_000, "0"]
  );
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
