import type { GearApi, HexString } from "@gear-js/api";
import { hexToU8a, u8aToHex } from "@polkadot/util";
import { getFnNamePrefix, getServiceNamePrefix } from "sails-js";
import { getVaraGearApi } from "@/lib/vara-rpc";
import {
  normalizeVaraExtrinsicHash,
  VARA_SHOP_RECIPIENT_ADDRESS,
} from "@/lib/shop-vara";
import {
  SHOP_PRODUCTS,
  shopPriceToAmount,
  SHOP_TOKEN_DECIMALS,
  type ShopProductId,
} from "@/lib/shop";
import { createVftRegistry } from "@/lib/vara-vft";
import { getVftPayloadDataOffset, toVaraActorId } from "@/lib/vara-address";

const RECEIPT_POLL_MS = 250;
const RECEIPT_MAX_WAIT_MS = 60_000;

function normalizeActorId(value: string): string {
  return toVaraActorId(value).toLowerCase();
}

function decodeTransferFromPayload(payloadHex: HexString): {
  to: string;
  value: bigint;
} {
  const service = getServiceNamePrefix(payloadHex);
  const fn = getFnNamePrefix(payloadHex);

  if (service !== "Vft" || fn !== "Transfer") {
    throw new Error("Payment transaction does not match the expected transfer.");
  }

  const payload = hexToU8a(payloadHex);
  const offset = getVftPayloadDataOffset(payloadHex);
  const remaining = payload.subarray(offset);
  const registry = createVftRegistry();

  try {
    const decoded = registry.createType("(String, String, [u8;32], U256)", remaining);
    return {
      to: u8aToHex(decoded[2] as Uint8Array).toLowerCase(),
      value: (decoded[3] as { toBigInt: () => bigint }).toBigInt(),
    };
  } catch {
    const decoded = registry.createType("([u8;32], U256)", remaining);
    return {
      to: u8aToHex(decoded[0] as Uint8Array).toLowerCase(),
      value: (decoded[1] as { toBigInt: () => bigint }).toBigInt(),
    };
  }
}

async function findExtrinsicBlock(
  api: GearApi,
  txHash: string,
  maxBlocks = 120
): Promise<{ blockHash: HexString; extrinsicIndex: number }> {
  let hash = await api.rpc.chain.getFinalizedHead();

  for (let i = 0; i < maxBlocks; i += 1) {
    const block = await api.rpc.chain.getBlock(hash);

    for (let index = 0; index < block.block.extrinsics.length; index += 1) {
      const extrinsic = block.block.extrinsics[index];
      if (extrinsic.hash.toHex().toLowerCase() === txHash) {
        return { blockHash: hash.toHex() as HexString, extrinsicIndex: index };
      }
    }

    hash = block.block.header.parentHash;
  }

  throw new Error("Timed out waiting for transaction confirmation.");
}

function getSendMessageArgs(extrinsic: {
  method: { section: string; method: string; args: Array<{ toHex: () => string }> };
}) {
  if (extrinsic.method.section !== "gear" || extrinsic.method.method !== "sendMessage") {
    throw new Error("Payment transaction does not match the expected transfer.");
  }

  const destination = extrinsic.method.args[0]?.toHex().toLowerCase();
  const payload = extrinsic.method.args[1]?.toHex() as HexString | undefined;

  if (!destination || !payload) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }

  return { destination, payload };
}

async function assertExtrinsicSucceeded(
  api: GearApi,
  blockHash: HexString,
  extrinsicIndex: number
): Promise<void> {
  const events = await api.query.system.events.at(blockHash);
  let sawSuccess = false;

  for (const record of events) {
    const { event, phase } = record;

    if (!phase.isApplyExtrinsic) continue;
    if (phase.asApplyExtrinsic.toNumber() !== extrinsicIndex) continue;

    if (api.events.system.ExtrinsicSuccess.is(event)) {
      sawSuccess = true;
    }

    if (api.events.system.ExtrinsicFailed.is(event)) {
      throw new Error("Transaction failed on chain.");
    }
  }

  if (!sawSuccess) {
    throw new Error("Transaction failed on chain.");
  }
}

async function waitForVaraExtrinsic(
  api: GearApi,
  txHash: string
): Promise<{ blockHash: HexString; extrinsicIndex: number }> {
  const deadline = Date.now() + RECEIPT_MAX_WAIT_MS;
  const normalized = normalizeVaraExtrinsicHash(txHash);

  while (Date.now() < deadline) {
    try {
      return await findExtrinsicBlock(api, normalized, 8);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!message.includes("Timed out waiting")) {
        throw err;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }

  throw new Error("Timed out waiting for transaction confirmation.");
}

export async function verifyVaraShopPaymentTx(params: {
  txHash: HexString;
  productId: ShopProductId;
  tokenProgramId: HexString;
  expectedFrom: string;
}): Promise<void> {
  if (!VARA_SHOP_RECIPIENT_ADDRESS) {
    throw new Error("Vara shop recipient is not configured.");
  }

  const api = await getVaraGearApi();
  const { blockHash, extrinsicIndex } = await waitForVaraExtrinsic(
    api,
    params.txHash
  );
  const block = await api.rpc.chain.getBlock(blockHash);
  const extrinsic = block.block.extrinsics[extrinsicIndex];

  const signer = extrinsic.signer.toString();
  if (signer !== params.expectedFrom) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }

  await assertExtrinsicSucceeded(api, blockHash, extrinsicIndex);

  const { destination, payload } = getSendMessageArgs(extrinsic);
  if (destination !== params.tokenProgramId.toLowerCase()) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }

  const transfer = decodeTransferFromPayload(payload);
  const product = SHOP_PRODUCTS[params.productId];
  const requiredAmount = shopPriceToAmount(product.priceUsd, SHOP_TOKEN_DECIMALS);
  const recipient = normalizeActorId(VARA_SHOP_RECIPIENT_ADDRESS);

  if (transfer.to !== recipient) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }

  if (transfer.value < requiredAmount) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }
}
