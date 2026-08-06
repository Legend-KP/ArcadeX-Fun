import { getAddress, type Hash } from "viem";
import { verifyShopPaymentTx } from "@/lib/shop-server";
import { findShopPaymentToken } from "@/lib/shop";
import {
  SCORE_SUBMIT_PRICE_USD,
  scoreSubmitPriceToAmount,
} from "@/lib/score-submit";
import { SHOP_TOKEN_DECIMALS } from "@/lib/shop";
import { verifySuiShopPaymentTx } from "@/lib/shop-sui-server";
import { verifyVaraShopPaymentTx } from "@/lib/shop-vara-server";
import { findVaraShopPaymentToken } from "@/lib/shop-vara";
import { isValidSuiTxDigest } from "@/lib/shop-sui";
import { isValidVaraExtrinsicHash } from "@/lib/shop-vara";
import { verifyScoreSubmitContractPaymentTx } from "@/lib/score-submit-contract-verify";
import { isScoreSubmitContractConfigured } from "@/lib/score-submit-contract";
import { isPaymentStillConfirmingError } from "@/lib/payment-tx-verify";
import type { WalletEcosystem } from "@/lib/player-identity";

/** Fixed-amount payment verification for public score submit. */
export async function verifyScoreSubmitPayment(params: {
  ecosystem: WalletEcosystem;
  txHash: string;
  tokenAddress?: string;
  expectedFrom: string;
}): Promise<void> {
  const requiredAmount = scoreSubmitPriceToAmount();

  if (params.ecosystem === "evm") {
    const token = findShopPaymentToken(params.tokenAddress ?? "");
    if (!token) throw new Error("Unsupported payment token.");

    if (isScoreSubmitContractConfigured()) {
      try {
        await verifyScoreSubmitContractPaymentTx(
          params.expectedFrom,
          params.txHash as Hash
        );
        return;
      } catch (err) {
        // Receipt not indexed yet — client should retry, don't fall through.
        if (isPaymentStillConfirmingError(err)) throw err;
        // Fall through to legacy USDC transfer verification.
      }
    }

    await verifyShopPaymentTx({
      txHash: params.txHash as Hash,
      productId: "spark-refill",
      tokenAddress: getAddress(token.address),
      expectedFrom: params.expectedFrom,
      overrideAmount: requiredAmount,
      legacyTransferOnly: true,
    });
    return;
  }

  if (params.ecosystem === "sui") {
    if (!isValidSuiTxDigest(params.txHash)) {
      throw new Error("Invalid Sui transaction digest.");
    }
    await verifySuiShopPaymentTx({
      txDigest: params.txHash,
      productId: "spark-refill",
      expectedFrom: params.expectedFrom,
      overrideAmount: requiredAmount,
    });
    return;
  }

  if (params.ecosystem === "vara") {
    if (!isValidVaraExtrinsicHash(params.txHash)) {
      throw new Error("Invalid transaction hash.");
    }
    const token = findVaraShopPaymentToken(params.tokenAddress ?? "");
    if (!token) throw new Error("Unsupported payment token.");

    await verifyVaraShopPaymentTx({
      txHash: params.txHash as Hash,
      productId: "spark-refill",
      tokenProgramId: token.programId,
      expectedFrom: params.expectedFrom,
      overrideAmount: requiredAmount,
    });
    return;
  }

  throw new Error("Score submit payments require EVM, Sui, or Vara wallet.");
}

export { SCORE_SUBMIT_PRICE_USD, SHOP_TOKEN_DECIMALS };
