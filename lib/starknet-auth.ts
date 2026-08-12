/** Cairo short-string encode without importing the full `starknet` package. */
function encodeShortString(value: string): string {
  if (value.length > 31) {
    throw new Error("Short string exceeds 31 characters.");
  }
  let hex = "0x";
  for (let i = 0; i < value.length; i++) {
    hex += value.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex === "0x" ? "0x0" : hex;
}

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
      action: encodeShortString("Sign in"),
      nonce: nonceFelt,
    },
  };
}
