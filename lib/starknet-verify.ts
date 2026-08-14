import { buildStarknetAuthTypedData } from "@/lib/starknet-auth";
import { normalizeAddress } from "@/lib/player-identity";

export async function verifyStarknetAuthSignature(params: {
  signature: string;
  nonce: string;
  address: string;
}): Promise<string> {
  let sigArray: string[];
  try {
    const parsed = JSON.parse(params.signature) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 2) {
      throw new Error("bad sig");
    }
    sigArray = parsed.map(String);
  } catch {
    throw new Error("Invalid Starknet signature format.");
  }

  const signer = normalizeAddress("starknet", params.address);
  const typedData = buildStarknetAuthTypedData(params.nonce);

  const { RpcProvider } = await import("starknet");
  const provider = new RpcProvider({
    nodeUrl:
      process.env.STARKNET_RPC_URL?.trim() ||
      "https://starknet-mainnet.public.blastapi.io/rpc/v0_9",
  });

  const valid = await provider.verifyMessageInStarknet(
    typedData,
    sigArray,
    signer
  );
  if (!valid) {
    throw new Error("Invalid Starknet signature.");
  }
  return signer;
}
