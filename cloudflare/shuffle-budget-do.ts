/**
 * One Durable Object per UTC day. Single-threaded reserve/confirm so the
 * shuffle USDC ceiling does not 412 on the RTDB meta node.
 *
 * Bundled only by wrangler (see cloudflare/worker.ts). Not imported by Next.
 */

import { DurableObject } from "cloudflare:workers";

type Reservation = {
  amountMicro: number;
  expiresAt: number;
  confirmed?: boolean;
};

type Meta = {
  spentMicro: number;
  reservedMicro: number;
};

function reservationStorageKey(reservationKey: string): string {
  return `res:${reservationKey.replace(/[.#$[\]/]/g, "_")}`;
}

export class ShuffleBudgetDO extends DurableObject {
  private async readMeta(): Promise<Meta> {
    const meta = (await this.ctx.storage.get<Meta>("meta")) ?? {
      spentMicro: 0,
      reservedMicro: 0,
    };
    return {
      spentMicro: Math.max(0, meta.spentMicro || 0),
      reservedMicro: Math.max(0, meta.reservedMicro || 0),
    };
  }

  private remainingOf(meta: Meta, budgetMicro: number): number {
    return Math.max(0, budgetMicro - meta.spentMicro - meta.reservedMicro);
  }

  async remaining(
    budgetMicro: number,
    _nowMs: number
  ): Promise<{ remainingMicro: number }> {
    const meta = await this.readMeta();
    return { remainingMicro: this.remainingOf(meta, budgetMicro) };
  }

  async reserve(opts: {
    amountMicro: number;
    reservationKey: string;
    expiresAtMs: number;
    nowMs: number;
    budgetMicro: number;
  }): Promise<{ ok: boolean; remainingMicro: number }> {
    const storageKey = reservationStorageKey(opts.reservationKey);
    const existing = await this.ctx.storage.get<Reservation>(storageKey);
    const meta = await this.readMeta();

    if (
      existing &&
      !existing.confirmed &&
      existing.amountMicro === opts.amountMicro &&
      existing.expiresAt > opts.nowMs
    ) {
      return { ok: true, remainingMicro: this.remainingOf(meta, opts.budgetMicro) };
    }

    if (existing?.confirmed) {
      return { ok: true, remainingMicro: this.remainingOf(meta, opts.budgetMicro) };
    }

    if (
      existing &&
      !existing.confirmed &&
      existing.expiresAt <= opts.nowMs &&
      existing.amountMicro > 0
    ) {
      meta.reservedMicro = Math.max(0, meta.reservedMicro - existing.amountMicro);
    }

    const remainingMicro = this.remainingOf(meta, opts.budgetMicro);
    if (opts.amountMicro > remainingMicro) {
      await this.ctx.storage.put("meta", meta);
      return { ok: false, remainingMicro };
    }

    meta.reservedMicro += opts.amountMicro;
    await this.ctx.storage.put("meta", meta);
    await this.ctx.storage.put(storageKey, {
      amountMicro: opts.amountMicro,
      expiresAt: opts.expiresAtMs,
    } satisfies Reservation);

    return {
      ok: true,
      remainingMicro: this.remainingOf(meta, opts.budgetMicro),
    };
  }

  async confirm(opts: {
    amountMicro: number;
    reservationKey: string;
    nowMs: number;
  }): Promise<void> {
    const storageKey = reservationStorageKey(opts.reservationKey);
    const existing = await this.ctx.storage.get<Reservation>(storageKey);
    if (existing?.confirmed) return;

    const meta = await this.readMeta();
    const addMicro = existing?.amountMicro ?? opts.amountMicro;
    const hadReservation = Boolean(existing) && !existing?.confirmed;

    if (
      existing &&
      !existing.confirmed &&
      existing.expiresAt <= opts.nowMs
    ) {
      // Expired reservation was still occupying reservedMicro until now.
    }

    meta.spentMicro += addMicro;
    if (hadReservation) {
      meta.reservedMicro = Math.max(0, meta.reservedMicro - addMicro);
    }

    await this.ctx.storage.put("meta", meta);
    await this.ctx.storage.put(storageKey, {
      amountMicro: addMicro,
      expiresAt: existing?.expiresAt ?? opts.nowMs,
      confirmed: true,
    } satisfies Reservation);
  }
}
