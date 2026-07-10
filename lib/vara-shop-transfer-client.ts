"use client";

import type { SubmittableExtrinsic } from "@polkadot/api/types";
import { web3Enable, web3FromAddress } from "@polkadot/extension-dapp";
import { VARA_RPC_URL } from "@/lib/shop-vara";

const VARA_APP_NAME = "ArcadeX";

async function getVaraApi() {
  const { ApiPromise, WsProvider } = await import("@polkadot/api");
  return ApiPromise.create({ provider: new WsProvider(VARA_RPC_URL) });
}

export async function transferVaraVftTokenOnClient(params: {
  tokenProgramId: string;
  fromAddress: string;
  productId: string;
}): Promise<string> {
  const extensions = await web3Enable(VARA_APP_NAME);
  if (!extensions.length) {
    throw new Error("Polkadot.js extension not found.");
  }

  const injector = await web3FromAddress(params.fromAddress);
  if (!injector.signer) {
    throw new Error("Selected account cannot sign transactions.");
  }

  const prepareRes = await fetch("/api/vara/shop/prepare-transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenProgramId: params.tokenProgramId,
      productId: params.productId,
    }),
  });

  const prepareData = (await prepareRes.json()) as {
    extrinsicHex?: string;
    error?: string;
  };

  if (!prepareRes.ok || !prepareData.extrinsicHex) {
    throw new Error(prepareData.error ?? "Could not prepare Vara transfer.");
  }

  const api = await getVaraApi();

  try {
    const extrinsic = api.registry.createType(
      "Extrinsic",
      prepareData.extrinsicHex
    ) as SubmittableExtrinsic<"promise">;

    const txHash = await new Promise<string>((resolve, reject) => {
      extrinsic
        .signAndSend(params.fromAddress, { signer: injector.signer }, (result) => {
          if (result.status.isInBlock || result.status.isFinalized) {
            if (result.dispatchError) {
              reject(new Error("Payment was cancelled or failed."));
              return;
            }

            resolve(extrinsic.hash.toHex());
          }
        })
        .catch(reject);
    });

    return txHash;
  } finally {
    await api.disconnect();
  }
}
