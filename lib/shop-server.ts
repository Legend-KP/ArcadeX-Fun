import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Hash,
} from "viem";
import { megaeth } from "@/lib/chains";
import {
  erc20Abi,
  findShopPaymentToken,
  SHOP_PRODUCTS,
  SHOP_RECIPIENT_ADDRESS,
  shopPriceToAmount,
  type ShopProductId,
} from "@/lib/shop";

const publicClient = createPublicClient({
  chain: megaeth,
  transport: http(),
});

export async function verifyShopPaymentTx(params: {
  txHash: Hash;
  productId: ShopProductId;
  tokenAddress: `0x${string}`;
  expectedFrom: string;
}): Promise<void> {
  const token = findShopPaymentToken(params.tokenAddress);
  if (!token) {
    throw new Error("Unsupported payment token.");
  }

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: params.txHash,
    confirmations: 1,
  });

  if (receipt.status !== "success") {
    throw new Error("Transaction failed on chain.");
  }

  const product = SHOP_PRODUCTS[params.productId];
  const decimals = await publicClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "decimals",
  });
  const requiredAmount = shopPriceToAmount(product.priceUsd, decimals);
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
