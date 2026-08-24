import {
  SparkSnapshot,
  SparkSlotView,
  StoredSparkState,
} from "@/types";

export const SPARK_MAX = 4;
export const SPARK_REGEN_MS = 180 * 60 * 1000;

export function defaultSparkState(): StoredSparkState {
  return {
    max: SPARK_MAX,
    regenMs: SPARK_REGEN_MS,
    slots: Array.from({ length: SPARK_MAX }, () => null),
  };
}

function coerceSlotValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value <= 0 ? null : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed <= 0 ? null : parsed;
  }
  return null;
}

function coerceSlots(raw: unknown, max: number): (number | null)[] {
  if (Array.isArray(raw)) {
    return Array.from({ length: max }, (_, i) => coerceSlotValue(raw[i]));
  }

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return Array.from({ length: max }, (_, i) =>
      coerceSlotValue(obj[String(i)] ?? obj[i])
    );
  }

  return Array.from({ length: max }, () => null);
}

export function coerceSparkState(raw: unknown): StoredSparkState {
  const defaults = defaultSparkState();

  if (!raw || typeof raw !== "object") {
    return defaults;
  }

  const data = raw as Partial<StoredSparkState>;
  const storedMax =
    typeof data.max === "number" && data.max > 0
      ? Math.floor(data.max)
      : defaults.max;
  const max = Math.max(storedMax, SPARK_MAX);
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

function isPending(slot: number | null, now: number): slot is number {
  return slot !== null && slot > now;
}

/**
 * Sequential refill: only one Spark regenerates at a time.
 * A newly spent Spark becomes ready at `latestPendingReadyAt + regenMs`
 * (or `now + regenMs` if nothing is regenerating).
 */
export function nextSequentialReadyAt(
  slots: (number | null)[],
  now: number,
  regenMs: number
): number {
  let latestPending = now;
  for (const slot of slots) {
    if (isPending(slot, now)) {
      latestPending = Math.max(latestPending, slot);
    }
  }
  return latestPending + regenMs;
}

/**
 * Rewrite pending readyAts so they are spaced exactly `regenMs` apart.
 * Migrates old parallel timers (many slots sharing ~the same readyAt).
 */
export function rechainSparkSlots(
  slots: (number | null)[],
  now: number,
  regenMs: number
): (number | null)[] {
  const pendingIndexes: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    if (isPending(slots[i], now)) pendingIndexes.push(i);
  }
  if (pendingIndexes.length <= 1) return slots;

  pendingIndexes.sort((a, b) => (slots[a] as number) - (slots[b] as number));

  const next = [...slots];
  let cursor = slots[pendingIndexes[0]] as number;
  next[pendingIndexes[0]] = cursor;
  for (let i = 1; i < pendingIndexes.length; i++) {
    cursor += regenMs;
    next[pendingIndexes[i]] = cursor;
  }
  return next;
}

export function findReadySparkSlotIndex(
  slots: (number | null)[],
  now: number
): number {
  return slots.findIndex((slot) => slot === null || slot <= now);
}

/** Spend one ready Spark and enqueue its sequential regen timer. */
export function applySparkSpend(
  state: StoredSparkState,
  now = Date.now()
): StoredSparkState | null {
  const normalized = normalizeSparkState(state, now);
  const readyIndex = findReadySparkSlotIndex(normalized.slots, now);
  if (readyIndex < 0) return null;

  const slots = [...normalized.slots];
  slots[readyIndex] = nextSequentialReadyAt(
    normalized.slots,
    now,
    normalized.regenMs
  );

  return {
    ...normalized,
    slots,
  };
}

export function normalizeSparkState(
  raw: StoredSparkState,
  now: number
): StoredSparkState {
  const state = coerceSparkState(raw);
  const expired = state.slots.map((slot) =>
    slot !== null && slot <= now ? null : slot
  );
  const slots = rechainSparkSlots(expired, now, state.regenMs);

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

function slotFill(
  readyAt: number | null,
  now: number,
  regenMs: number
): number {
  if (readyAt === null || now >= readyAt) return 1;
  const remaining = readyAt - now;
  if (remaining >= regenMs) return 0;
  return 1 - remaining / regenMs;
}

function slotStatus(
  readyAt: number | null,
  now: number,
  regenMs: number
): SparkSlotView["status"] {
  if (readyAt === null || now >= readyAt) return "ready";
  return readyAt - now > regenMs ? "queued" : "regenerating";
}

function slotView(
  index: number,
  slot: number | null,
  regenMs: number,
  now: number
): SparkSlotView {
  const status = slotStatus(slot, now, regenMs);
  if (status === "ready") {
    return {
      index,
      status,
      fillPercent: 100,
      timeRemainingMs: 0,
    };
  }

  return {
    index,
    status,
    fillPercent: Math.round(slotFill(slot, now, regenMs) * 100),
    timeRemainingMs: Math.max(0, (slot as number) - now),
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
  const pending = slots.filter((s) => s.status !== "ready");
  const remainders = pending.map((s) => s.timeRemainingMs);
  const hasInfinite =
    typeof state.infiniteUntil === "number" && state.infiniteUntil > now;

  return {
    max: state.max,
    available,
    fillPercent: state.max > 0 ? (available / state.max) * 100 : 0,
    timeToNextMs: remainders.length > 0 ? Math.min(...remainders) : 0,
    timeToFullMs: remainders.length > 0 ? Math.max(...remainders) : 0,
    slots,
    regeneratingCount: pending.length,
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

/** True when stored max/slot count is below the current Spark bar. */
export function rawSparkNeedsUpgrade(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return true;
  const data = raw as Partial<StoredSparkState> & { slots?: unknown };
  const max = typeof data.max === "number" ? data.max : 0;
  if (max < SPARK_MAX) return true;

  const slotCount = Array.isArray(data.slots)
    ? data.slots.length
    : data.slots && typeof data.slots === "object"
      ? Object.keys(data.slots).length
      : 0;
  return slotCount < SPARK_MAX;
}

/** Persist max upgrades and parallel→sequential rechain, not mere expirations. */
export function shouldPersistSparkMigration(
  stored: StoredSparkState,
  normalized: StoredSparkState,
  now: number
): boolean {
  if (stored.max !== normalized.max) return true;
  if (stored.regenMs !== normalized.regenMs) return true;
  if (stored.slots.length !== normalized.slots.length) return true;

  for (let i = 0; i < stored.slots.length; i++) {
    const before = stored.slots[i];
    const after = normalized.slots[i];
    const beforePending = before !== null && before > now;
    const afterPending = after !== null && after > now;
    if (beforePending && afterPending && before !== after) return true;
  }

  return false;
}
