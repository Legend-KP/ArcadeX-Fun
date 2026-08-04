import { formatUnits, type Address, type Hash } from "viem";
import { base } from "@/lib/chains";
import {
  getBasePublicClient,
  readBaseContract,
} from "@/lib/base-public-client";
import { createEvmWalletClient } from "@/lib/evm-wallet-client";
import {
  BASE_USDC,
  ERC20_ABI,
  isScoreSubmitContractConfigured,
  SCORE_SUBMIT_ABI,
  SCORE_SUBMIT_CONTRACT_ADDRESS,
  STABLECOIN_DECIMALS,
  type ScoreSubmitPaymentToken,
} from "@/lib/score-submit-contract";

async function readBalance(token: Address, account: Address): Promise<bigint> {
  return readBaseContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account],
  });
}

async function assertSufficientUsdc(account: Address, fee: bigint): Promise<void> {
  const balance = await readBalance(BASE_USDC, account);
  if (balance >= fee) return;

  const needed = formatUnits(fee, STABLECOIN_DECIMALS);
  throw new Error(`Insufficient balance. You need $${needed} in USDC.`);
}

export async function purchaseScoreSubmitOnChain(): Promise<{
  txHash: Hash;
  token: ScoreSubmitPaymentToken;
}> {
  if (!isScoreSubmitContractConfigured()) {
    throw new Error("Score submit contract is not configured yet.");
  }

  const walletClient = createEvmWalletClient();
  if (!walletClient) {
    throw new Error("Connect your wallet to submit your score.");
  }

  const [account] = await walletClient.getAddresses();
  if (!account) {
    throw new Error("No wallet account available.");
  }

  const fee = await readBaseContract({
    address: SCORE_SUBMIT_CONTRACT_ADDRESS,
    abi: SCORE_SUBMIT_ABI,
    functionName: "fee",
  });

  await assertSufficientUsdc(account, fee);

  const allowance = await readBaseContract({
    address: BASE_USDC,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, SCORE_SUBMIT_CONTRACT_ADDRESS],
  });

  const publicClient = getBasePublicClient();

  if (allowance < fee) {
    const approveHash = await walletClient.writeContract({
      account,
      chain: base,
      address: BASE_USDC,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [SCORE_SUBMIT_CONTRACT_ADDRESS, fee],
    });

    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
    });

    if (approveReceipt.status !== "success") {
      throw new Error("Token approval failed.");
    }
  }

  const payHash = await walletClient.writeContract({
    account,
    chain: base,
    address: SCORE_SUBMIT_CONTRACT_ADDRESS,
    abi: SCORE_SUBMIT_ABI,
    functionName: "payWithUSDC",
  });

  const payReceipt = await publicClient.waitForTransactionReceipt({
    hash: payHash,
  });

  if (payReceipt.status !== "success") {
    throw new Error("Score submission payment failed.");
  }

  return { txHash: payHash, token: "USDC" };
}
