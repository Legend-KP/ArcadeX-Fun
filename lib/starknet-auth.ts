import { shortString } from "starknet";

export function buildStarknetAuthTypedData(nonce: string) {
  const nonceFelt = nonce.startsWith("0x")
    ? nonce
    : `0x${BigInt(`0x${nonce}`).toString(16)}`;

  return {
    types: {
      StarkNetDomain: [
        { name: "name", type: "felt" },
        { name: "version", type: "felt" },
        { name: "chainId", type: "felt" },
      ],
      Message: [
        { name: "action", type: "felt" },
        { name: "nonce", type: "felt" },
      ],
    },
    primaryType: "Message",
    domain: {
      name: "ArcadeX",
      version: "1",
      chainId: "0x534e5f4d41494e",
    },
    message: {
      action: shortString.encodeShortString("Sign in"),
      nonce: nonceFelt,
    },
  };
}
