"use client";

import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { web3Accounts, web3FromAddress } from "@polkadot/extension-dapp";
import {
  assertVaraTxHubConfigured,
  playPurpose,
  VARA_RPC_URL,
} from "@/lib/vara-tx-hub";
import { varaJsonRpc } from "@/lib/vara-rpc-http";
import { encodeTxHubSignInPayload } from "@/lib/vara-tx-hub-codec";
import {
  ensureVaraCryptoReady,
  toVaraActorId,
} from "@/lib/vara-address";
import { WalletSessionMismatchError } from "@/lib/evm-session-wallet";
import {
  ensureVaraExtensions,
  varaWalletLabel,
} from "@/lib/vara-wallet-client";

const SIGN_IN_TIMEOUT_MS = 120_000;

/**
 * Injected wallets keep accounts under the SS58 they injected (often prefix 42).
 * Session/playerId may be re-encoded to Vara prefix 137 — match by ActorId.
 */
export async function resolveVaraSigningAddress(
  preferredAddress: string
): Promise<string> {
  await ensureVaraCryptoReady();
  const ready = await ensureVaraExtensions();
  if (!ready) {
    throw new Error(
      "No Substrate wallet found. Unlock your wallet and allow ArcadeX, then try again."
    );
  }

  const accounts = await web3Accounts();
  if (!accounts.length) {
    throw new Error("No wallet accounts available.");
  }

  const target = toVaraActorId(preferredAddress);
  const match = accounts.find((account) => {
    try {
      return toVaraActorId(account.address) === target;
    } catch {
      return false;
    }
  });

  if (!match) {
    throw new WalletSessionMismatchError(
      accounts[0]!.address,
      preferredAddress
    );
  }

  return match.address;
}

async function calculateSignInGas(params: {
  programId: string;
  fromAddress: string;
  payload: string;
}): Promise<bigint> {
  const origin = toVaraActorId(params.fromAddress);
  const gasInfo = await varaJsonRpc<{
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
  const gas = BigInt(raw);
  return (gas * BigInt(12)) / BigInt(10);
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

/**
 * Free on-chain sign_in for Start Game (play purpose).
 * Returns extrinsic hash.
 */
export async function signInOnVaraTxHub(params: {
  fromAddress: string;
  gameId: string;
  onStatus?: (message: string) => void;
}): Promise<string> {
  const programId = assertVaraTxHubConfigured();
  params.onStatus?.("Connecting wallet…");

  const signingAddress = await resolveVaraSigningAddress(params.fromAddress);
  const injector = await web3FromAddress(signingAddress);
  if (!injector.signer) {
    throw new Error("Selected account cannot sign transactions.");
  }
  const wallet = varaWalletLabel(injector.name);

  const purpose = playPurpose(params.gameId);
  const payload = encodeTxHubSignInPayload(purpose);

  params.onStatus?.("Estimating gas…");
  const gasLimit = await calculateSignInGas({
    programId,
    fromAddress: signingAddress,
    payload,
  });

  params.onStatus?.("Connecting to Vara…");
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const api = await withTimeout(
    ApiPromise.create({ provider: new WsProvider(VARA_RPC_URL) }),
    30_000,
    "Timed out connecting to Vara RPC. Check your network and try again."
  );

  try {
    const extrinsic = api.tx.gear.sendMessage(
      programId,
      payload,
      gasLimit,
      0,
      true
    ) as SubmittableExtrinsic<"promise">;

    params.onStatus?.(`Approve the free sign-in in ${wallet}…`);

    const txHash = await withTimeout(
      new Promise<string>((resolve, reject) => {
        extrinsic
          .signAndSend(
            signingAddress,
            { signer: injector.signer },
            (result) => {
              if (result.isError) {
                reject(new Error("Sign-in transaction failed."));
                return;
              }
              if (result.status.isInBlock || result.status.isFinalized) {
                if (result.dispatchError) {
                  reject(new Error("Sign-in transaction failed on-chain."));
                  return;
                }
                resolve(extrinsic.hash.toHex());
              }
            }
          )
          .catch(reject);
      }),
      SIGN_IN_TIMEOUT_MS,
      "Timed out waiting for wallet approval. Open your wallet, approve the transaction, then try again."
    );

    return txHash;
  } finally {
    await api.disconnect();
  }
}
