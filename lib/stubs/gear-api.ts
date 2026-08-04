/** Server-side stub — keeps @gear-js/api out of the Cloudflare Worker bundle. */
export class GearApi {
  static async create(): Promise<GearApi> {
    throw new Error(
      "Vara Gear API runs in the browser only (Cloudflare Worker size limit)."
    );
  }

  async disconnect(): Promise<void> {}
}

export type HexString = `0x${string}`;

export function decodeAddress(_address: string): Uint8Array {
  throw new Error("decodeAddress is not available on the server Worker.");
}
