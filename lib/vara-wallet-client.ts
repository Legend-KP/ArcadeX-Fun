"use client";

import { web3Accounts, web3Enable, web3FromAddress } from "@polkadot/extension-dapp";
import { stringToU8a, u8aToHex } from "@polkadot/util";
import { buildPlainAuthMessage } from "@/lib/plain-auth";

const VARA_APP_NAME = "ArcadeX";

export async function connectVaraWallet(): Promise<string> {
  const extensions = await web3Enable(VARA_APP_NAME);
  if (!extensions.length) {
    throw new Error(
      "Polkadot.js extension not found. Install it and create a Vara account."
    );
  }

  const accounts = await web3Accounts();
  const account = accounts[0];
  if (!account) {
    throw new Error("No Vara-compatible account found in Polkadot.js.");
  }

  return account.address;
}

export async function signVaraMessage(
  address: string,
  nonce: string
): Promise<{ address: string; signature: string; message: string }> {
  const extensions = await web3Enable(VARA_APP_NAME);
  if (!extensions.length) {
    throw new Error("Polkadot.js extension not found.");
  }

  const injector = await web3FromAddress(address);
  if (!injector.signer.signRaw) {
    throw new Error("Selected account cannot sign messages.");
  }

  const message = buildPlainAuthMessage(nonce);
  const { signature } = await injector.signer.signRaw({
    address,
    data: u8aToHex(stringToU8a(message)),
    type: "bytes",
  });

  return { address, signature, message };
}
