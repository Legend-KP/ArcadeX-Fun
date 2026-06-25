import {
  SparkSnapshot,
  SparkSlotView,
  StoredSparkState,
} from "@/types";

export const SPARK_MAX = 3;
export const SPARK_REGEN_MS = 180 * 60 * 1000;

export function defaultSparkState(): StoredSparkState {
  return {
    max: SPARK_MAX,
    regenMs: SPARK_REGEN_MS,
    slots: [null, null, null],
  };
}

function coerceSlots(raw: unknown, max: number): (number | null)[] {
  if (Array.isArray(raw)) {
    return Array.from({ length: max }, (_, i) => {
      const v = raw[i];
      return typeof v === "number" ? v : v === null || v === undefined ? null : null;
    });
  }

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return Array.from({ length: max }, (_, i) => {
      const v = obj[String(i)] ?? obj[i];
      return typeof v === "number" ? v : null;
    });
  }

  return Array.from({ length: max }, () => null);
}

export function coerceSparkState(raw: unknown): StoredSparkState {
  const defaults = defaultSparkState();

  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const data = raw as Partial<StoredSparkState>;
  const max =
    typeof data.max === "number" && data.max > 0
      ? Math.floor(data.max)
      : defaults.max;
  const regenMs =
    typeof data.regenMs === "number" && data.regenMs > 0
      ? data.regenMs
      : defaults.regenMs;

  return {
    max,
    regenMs,
    slots: coerceSlots(data.slots, max),
    ...(typeof data.infiniteUntil === "number"
      ? { infiniteUntil: data.infiniteUntil }
      : {}),
  };
}

export function normalizeSparkState(
  raw: StoredSparkState,
  now: number
): StoredSparkState {
  const state = coerceSparkState(raw);
  const slots = state.slots.map((slot) =>
    slot !== null && slot <= now ? null : slot
  );

  const infiniteUntil =
    typeof state.infiniteUntil === "number" && state.infiniteUntil > now
      ? state.infiniteUntil
      : undefined;

  return {
    ...state,
    slots,
    ...(infiniteUntil !== undefined ? { infiniteUntil } : {}),
  };
}

function slotView(
  index: number,
  slot: number | null,
  regenMs: number,
  now: number
): SparkSlotView {
  if (slot === null || slot <= now) {
    return {
      index,
      status: "ready",
      fillPercent: 100,
      timeRemainingMs: 0,
    };
  }

  const timeRemainingMs = Math.max(0, slot - now);
  const elapsed = regenMs - timeRemainingMs;
  const fillPercent = Math.min(100, Math.max(0, (elapsed / regenMs) * 100));

  return {
    index,
    status: "regenerating",
    fillPercent,
    timeRemainingMs,
  };
}

export function computeSparkSnapshot(
  raw: StoredSparkState,
  now: number
): SparkSnapshot {
  const state = normalizeSparkState(raw, now);
  const slots = state.slots.map((slot, index) =>
    slotView(index, slot, state.regenMs, now)
  );

  const available = slots.filter((s) => s.status === "ready").length;
  const regenerating = slots.filter((s) => s.status === "regenerating");
  const regeneratingCount = regenerating.length;
  const remainders = regenerating.map((s) => s.timeRemainingMs);
  const hasInfinite =
    typeof state.infiniteUntil === "number" && state.infiniteUntil > now;

  return {
    max: state.max,
    available,
    fillPercent: state.max > 0 ? (available / state.max) * 100 : 0,
    timeToNextMs: remainders.length > 0 ? Math.min(...remainders) : 0,
    timeToFullMs: remainders.length > 0 ? Math.max(...remainders) : 0,
    slots,
    regeneratingCount,
    hasInfinite,
    ...(hasInfinite ? { infiniteUntil: state.infiniteUntil } : {}),
  };
}

export function formatSparkCountdown(ms: number): string {
  if (ms <= 0) return "0s";

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

export function formatSparkDuration(ms: number): string {
  if (ms <= 0) return "0m";

  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function mockSparkSnapshot(): SparkSnapshot {
  return computeSparkSnapshot(defaultSparkState(), Date.now());
}
