import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  TransactionReceiptNotFoundError,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { megaeth } from "@/lib/chains";
import {
  erc20Abi,
  findShopPaymentToken,
  SHOP_PRODUCTS,
  SHOP_RECIPIENT_ADDRESS,
  SHOP_TOKEN_DECIMALS,
  shopPriceToAmount,
  type ShopProductId,
} from "@/lib/shop";

const RECEIPT_POLL_MS = 250;
const RECEIPT_MAX_WAIT_MS = 60_000;

const publicClient = createPublicClient({
  chain: megaeth,
  transport: http(megaeth.rpcUrls.default.http[0], {
    timeout: 12_000,
  }),
});

async function waitForReceipt(hash: Hash): Promise<TransactionReceipt> {
  const deadline = Date.now() + RECEIPT_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      return receipt;
    } catch (err) {
      if (!(err instanceof TransactionReceiptNotFoundError)) {
        throw err;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS));
  }

  throw new Error("Timed out waiting for transaction confirmation.");
}

export async function verifyShopPaymentTx(params: {
  txHash: Hash;
  productId: ShopProductId;
  tokenAddress: `0x${string}`;
  expectedFrom: string;
  overrideAmount?: bigint;
}): Promise<void> {
  const token = findShopPaymentToken(params.tokenAddress);
  if (!token) {
    throw new Error("Unsupported payment token.");
  }

  const receipt = await waitForReceipt(params.txHash);

  if (receipt.status !== "success") {
    throw new Error("Transaction failed on chain.");
  }

  const product = SHOP_PRODUCTS[params.productId];
  const requiredAmount =
    params.overrideAmount ??
    shopPriceToAmount(product.priceUsd, SHOP_TOKEN_DECIMALS);
  const recipient = getAddress(SHOP_RECIPIENT_ADDRESS);
  const from = getAddress(params.expectedFrom);
  const tokenAddress = getAddress(token.address);

  let matched = false;

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== tokenAddress) continue;

    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics,
        eventName: "Transfer",
      });

      if (
        getAddress(decoded.args.from) === from &&
        getAddress(decoded.args.to) === recipient &&
        decoded.args.value >= requiredAmount
      ) {
        matched = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!matched) {
    throw new Error("Payment transaction does not match the expected transfer.");
  }
}
