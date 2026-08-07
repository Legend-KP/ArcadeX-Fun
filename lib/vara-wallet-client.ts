"use client";

import { web3Accounts, web3Enable, web3FromAddress } from "@polkadot/extension-dapp";
import { stringToU8a, u8aToHex } from "@polkadot/util";
import { buildPlainAuthMessage } from "@/lib/plain-auth";
import {
  ensureVaraCryptoReady,
  isLikelyEvmAddress,
  isVaraWalletAddress,
} from "@/lib/vara-address";

const VARA_APP_NAME = "ArcadeX";

export async function connectVaraWallet(): Promise<string> {
  await ensureVaraCryptoReady();

  const extensions = await web3Enable(VARA_APP_NAME);
  if (!extensions.length) {
    throw new Error(
      "SubWallet / Polkadot.js not found. Install SubWallet and create a Vara (Substrate) account."
    );
  }

  const accounts = await web3Accounts();
  const substrateAccounts = accounts.filter((account) => {
    if (account.type === "ethereum") return false;
    if (isLikelyEvmAddress(account.address)) return false;
    return isVaraWalletAddress(account.address);
  });

  const account = substrateAccounts[0] ?? accounts[0];
  if (!account) {
    throw new Error(
      "No Vara account found. In SubWallet, select a Substrate/Vara account (not EVM)."
    );
  }

  if (
    account.type === "ethereum" ||
    isLikelyEvmAddress(account.address) ||
    !isVaraWalletAddress(account.address)
  ) {
    throw new Error(
      "SubWallet returned an EVM account. Switch to a Vara / Substrate account, then reconnect."
    );
  }

  // Keep the extension's SS58 as-is so SubWallet can sign for this account.
  // Server-side normalizeVaraAddress re-encodes to Vara prefix when possible.
  return account.address;
}

export async function signVaraMessage(
  address: string,
  nonce: string
): Promise<{ address: string; signature: string; message: string }> {
  await ensureVaraCryptoReady();

  const extensions = await web3Enable(VARA_APP_NAME);
  if (!extensions.length) {
    throw new Error("SubWallet / Polkadot.js not found.");
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
