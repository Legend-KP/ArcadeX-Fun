/** Server-side stub — keeps @polkadot/api out of the Cloudflare Worker bundle. */
export class ApiPromise {
  static async create(): Promise<ApiPromise> {
    throw new Error("Polkadot API is not available in this deployment.");
  }
}

export class WsProvider {
  constructor(_endpoint?: string) {}
}
