import type { GearApi, HexString } from "@gear-js/api";
import { decodeAddress } from "@gear-js/api";
import { TypeRegistry } from "@polkadot/types";
import { TransactionBuilder, ZERO_ADDRESS } from "sails-js";

export type ActorId = HexString;

const VFT_EVENT_TYPES = {
  Transfer: { from: "[u8;32]", to: "[u8;32]", value: "U256" },
  Minted: { to: "[u8;32]", value: "U256" },
  Burned: { from: "[u8;32]", value: "U256" },
  Approval: { owner: "[u8;32]", spender: "[u8;32]", value: "U256" },
};

export function createVftRegistry(): TypeRegistry {
  const registry = new TypeRegistry();
  registry.setKnownTypes({ types: VFT_EVENT_TYPES });
  registry.register(VFT_EVENT_TYPES);
  return registry;
}

export class VftProgram {
  public readonly registry: TypeRegistry;
  public readonly vft: VftService;

  constructor(
    public api: GearApi,
    private _programId: HexString
  ) {
    this.registry = createVftRegistry();
    this.vft = new VftService(this);
  }

  get programId(): HexString {
    return this._programId;
  }
}

export class VftService {
  constructor(private _program: VftProgram) {}

  transfer(
    to: ActorId,
    value: number | string | bigint
  ): TransactionBuilder<boolean> {
    return new TransactionBuilder(
      this._program.api,
      this._program.registry,
      "send_message",
      "Vft",
      "Transfer",
      ["Vft", "Transfer", to, value],
      "(String, String, [u8;32], U256)",
      "bool",
      this._program.programId
    );
  }

  async balanceOf(
    account: ActorId,
    originAddress?: string
  ): Promise<bigint> {
    const payload = this._program.registry
      .createType("(String, String, [u8;32])", ["Vft", "BalanceOf", account])
      .toHex();

    const reply = await this._program.api.message.calculateReply({
      destination: this._program.programId,
      origin: originAddress ? decodeAddress(originAddress) : ZERO_ADDRESS,
      payload,
      value: 0,
      gasLimit: this._program.api.blockGasLimit.toBigInt(),
    });

    if (!reply.code.isSuccess) {
      throw new Error(
        this._program.registry.createType("String", reply.payload).toString()
      );
    }

    const result = this._program.registry.createType(
      "(String, String, U256)",
      reply.payload
    );

    return (result[2] as { toBigInt: () => bigint }).toBigInt();
  }

  async decimals(originAddress?: string): Promise<number> {
    const payload = this._program.registry
      .createType("(String, String)", ["Vft", "Decimals"])
      .toHex();

    const reply = await this._program.api.message.calculateReply({
      destination: this._program.programId,
      origin: originAddress ? decodeAddress(originAddress) : ZERO_ADDRESS,
      payload,
      value: 0,
      gasLimit: this._program.api.blockGasLimit.toBigInt(),
    });

    if (!reply.code.isSuccess) {
      throw new Error(
        this._program.registry.createType("String", reply.payload).toString()
      );
    }

    const result = this._program.registry.createType(
      "(String, String, u8)",
      reply.payload
    );

    return Number(result[2]);
  }
}
