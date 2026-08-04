import type { Address, Hash } from "viem";
import {
  BASE_USDC,
  SCORE_SUBMIT_ABI,
  SCORE_SUBMIT_CONTRACT_ADDRESS,
  type ScoreSubmitPaymentToken,
} from "@/lib/score-submit-contract";
import { verifyEntryPaidPaymentTx } from "@/lib/payment-tx-verify";

export interface VerifiedScoreSubmitPayment {
  player: Address;
  token: ScoreSubmitPaymentToken;
  amount: bigint;
}

export async function verifyScoreSubmitContractPaymentTx(
  walletAddress: string,
  txHash: Hash
): Promise<VerifiedScoreSubmitPayment> {
  const verified = await verifyEntryPaidPaymentTx({
    walletAddress,
    txHash,
    contractAddress: SCORE_SUBMIT_CONTRACT_ADDRESS,
    abi: SCORE_SUBMIT_ABI,
    usdcAddress: BASE_USDC,
    contractLabel: "ScoreSubmit",
  });

  return { ...verified, token: "USDC" };
}
