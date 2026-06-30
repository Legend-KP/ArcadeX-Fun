import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";

let suiClient: SuiJsonRpcClient | null = null;

export function getSuiRpcClient(): SuiJsonRpcClient {
  if (!suiClient) {
    const url =
      process.env.SUI_RPC_URL?.trim() ||
      process.env.NEXT_PUBLIC_SUI_RPC_URL?.trim() ||
      getJsonRpcFullnodeUrl("mainnet");

    suiClient = new SuiJsonRpcClient({
      url,
      network: "mainnet",
    });
  }

  return suiClient;
}
