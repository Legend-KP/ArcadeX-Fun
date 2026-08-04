/** Server-side stub — keeps @gear-js/api out of the Cloudflare Worker bundle. */
export class GearApi {
  static async create(): Promise<GearApi> {
    throw new Error(
      "Vara RPC is not available in this deployment. Use Base (EVM) or Sui for shop payments."
    );
  }

  async disconnect(): Promise<void> {}
}

export type HexString = `0x${string}`;
