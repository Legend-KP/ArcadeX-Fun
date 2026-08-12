/**
 * Thin Sui JSON-RPC client — no `@mysten/sui` dependency (keeps Worker under 3 MiB).
 */

export type SuiBalance = { totalBalance: string };

export type SuiTransactionBlock = {
  effects?: { status?: { status?: string } };
  balanceChanges?: Array<{
    coinType: string;
    amount: string;
    owner?: unknown;
  }>;
};

const DEFAULT_SUI_RPC = "https://fullnode.mainnet.sui.io:443";

export class ThinSuiRpcClient {
  constructor(private readonly url: string) {}

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }),
    });
    if (!res.ok) {
      throw new Error(`Sui RPC HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      result?: T;
      error?: { message?: string };
    };
    if (body.error) {
      throw new Error(body.error.message ?? "Sui RPC error");
    }
    return body.result as T;
  }

  async getBalance(params: {
    owner: string;
    coinType: string;
  }): Promise<SuiBalance> {
    return this.call<SuiBalance>("suix_getBalance", [
      params.owner,
      params.coinType,
    ]);
  }

  async getTransactionBlock(params: {
    digest: string;
    options?: {
      showEffects?: boolean;
      showBalanceChanges?: boolean;
    };
  }): Promise<SuiTransactionBlock> {
    return this.call<SuiTransactionBlock>("sui_getTransactionBlock", [
      params.digest,
      {
        showInput: false,
        showRawInput: false,
        showEffects: params.options?.showEffects ?? true,
        showEvents: false,
        showObjectChanges: false,
        showBalanceChanges: params.options?.showBalanceChanges ?? true,
      },
    ]);
  }
}

let suiClient: ThinSuiRpcClient | null = null;

export function getSuiRpcClient(): ThinSuiRpcClient {
  if (!suiClient) {
    const url =
      process.env.SUI_RPC_URL?.trim() ||
      process.env.NEXT_PUBLIC_SUI_RPC_URL?.trim() ||
      DEFAULT_SUI_RPC;
    suiClient = new ThinSuiRpcClient(url);
  }
  return suiClient;
}
