/** Server-side stub — keeps sails-js out of the Cloudflare Worker bundle. */
export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export class TransactionBuilder {
  constructor(
    ..._args: unknown[]
  ) {}

  withAccount(_address: string): this {
    return this;
  }

  async calculateGas(_throwOnError?: boolean, _gasLimit?: number): Promise<this> {
    throw new Error("TransactionBuilder is not available on the server Worker.");
  }

  get extrinsic(): { toHex: () => string } {
    throw new Error("TransactionBuilder is not available on the server Worker.");
  }
}

export function getFnNamePrefix(_payload: string): string {
  throw new Error("sails-js is not available on the server Worker.");
}

export function getServiceNamePrefix(_payload: string): string {
  throw new Error("sails-js is not available on the server Worker.");
}
