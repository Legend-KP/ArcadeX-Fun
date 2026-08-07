"use client";

import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { web3FromAddress } from "@polkadot/extension-dapp";
import {
  assertVaraShopRecipientConfigured,
  findVaraShopPaymentToken,
  VARA_RPC_URL,
  VARA_SHOP_RECIPIENT_ADDRESS,
} from "@/lib/shop-vara";
import {
  isShopProductId,
  SHOP_PRODUCTS,
  shopPriceToAmount,
  SHOP_TOKEN_DECIMALS,
  type ShopProductId,
} from "@/lib/shop";
import {
  buildVftTransferPayload,
  calculateVftTransferGas,
} from "@/lib/vara-http-rpc";
import { toVaraActorId } from "@/lib/vara-address";
import { resolveVaraSigningAddress } from "@/lib/vara-tx-hub-client";

export async function transferVaraVftTokenOnClient(params: {
  tokenProgramId: string;
  fromAddress: string;
  productId: string;
}): Promise<string> {
  assertVaraShopRecipientConfigured();

  if (!isShopProductId(params.productId)) {
    throw new Error("Unknown shop product.");
  }

  const token = findVaraShopPaymentToken(params.tokenProgramId);
  if (!token) {
    throw new Error("Unsupported payment token.");
  }

  const signingAddress = await resolveVaraSigningAddress(params.fromAddress);
  const injector = await web3FromAddress(signingAddress);
  if (!injector.signer) {
    throw new Error("Selected account cannot sign transactions.");
  }

  const amount = shopPriceToAmount(
    SHOP_PRODUCTS[params.productId as ShopProductId].priceUsd,
    SHOP_TOKEN_DECIMALS
  );
  const toActorId = toVaraActorId(VARA_SHOP_RECIPIENT_ADDRESS);
  const payload = buildVftTransferPayload(toActorId, amount);
  const gasLimit = await calculateVftTransferGas({
    programId: token.programId,
    fromAddress: signingAddress,
    toActorId,
    amount,
  });

  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  const api = await ApiPromise.create({
    provider: new WsProvider(VARA_RPC_URL),
  });

  try {
    const extrinsic = api.tx.gear.sendMessage(
      token.programId,
      payload,
      gasLimit,
      0,
      true
    ) as SubmittableExtrinsic<"promise">;

    const txHash = await new Promise<string>((resolve, reject) => {
      extrinsic
        .signAndSend(
          signingAddress,
          { signer: injector.signer },
          (result) => {
            if (result.status.isInBlock || result.status.isFinalized) {
              if (result.dispatchError) {
                reject(new Error("Payment was cancelled or failed."));
                return;
              }
              resolve(extrinsic.hash.toHex());
            }
          }
        )
        .catch(reject);
    });

    return txHash;
  } finally {
    await api.disconnect();
  }
}
