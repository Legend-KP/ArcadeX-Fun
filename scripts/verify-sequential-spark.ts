import {
  applySparkSpend,
  coerceSparkState,
  computeSparkSnapshot,
  defaultSparkState,
  normalizeSparkState,
  rawSparkNeedsUpgrade,
  shouldPersistSparkMigration,
  SPARK_MAX,
  SPARK_REGEN_MS,
} from "../lib/spark";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const t0 = 1_700_000_000_000;
const hour = 60 * 60 * 1000;

assert(SPARK_MAX === 4, "bar must be 4 Sparks");
assert(defaultSparkState().slots.length === 4, "default slots must be 4");

let state = defaultSparkState();
state = applySparkSpend(state, t0)!;
assert(
  state.slots.filter((s) => s !== null).length === 1,
  "one slot regenerating after first spend"
);
assert(
  state.slots.includes(t0 + SPARK_REGEN_MS),
  "first spend ready at t0+3h"
);

state = applySparkSpend(state, t0 + hour)!;
const pending = state.slots.filter((s): s is number => s !== null).sort((a, b) => a - b);
assert(pending[0] === t0 + SPARK_REGEN_MS, "first spark still finishes at t0+3h");
assert(pending[1] === t0 + 2 * SPARK_REGEN_MS, "second spark queued until t0+6h");

const snap1h = computeSparkSnapshot(state, t0 + hour);
assert(snap1h.available === 2, "2 ready after 2 spends from a full bar of 4");
const statuses1h = snap1h.slots.map((s) => s.status).sort();
assert(
  statuses1h.filter((s) => s === "ready").length === 2,
  "two ready"
);
assert(
  snap1h.slots.filter((s) => s.status === "regenerating").length === 1,
  "exactly one regenerating"
);
assert(
  snap1h.slots.filter((s) => s.status === "queued").length === 1,
  "exactly one queued"
);

const snap3h = computeSparkSnapshot(state, t0 + SPARK_REGEN_MS);
assert(snap3h.available === 3, "first spark ready at +3h");
assert(
  snap3h.slots.filter((s) => s.status === "regenerating").length === 1,
  "queued spark starts regenerating when the first finishes"
);
assert(
  snap3h.slots.filter((s) => s.status === "queued").length === 0,
  "no queued slot once the first finishes"
);

let empty = defaultSparkState();
for (let i = 0; i < 4; i++) empty = applySparkSpend(empty, t0)!;
const emptySnap = computeSparkSnapshot(empty, t0);
assert(emptySnap.available === 0, "empty bar has 0 available");
assert(
  emptySnap.timeToFullMs === 4 * SPARK_REGEN_MS,
  "empty bar takes 12h to fill"
);
assert(
  emptySnap.timeToNextMs === SPARK_REGEN_MS,
  "next spark in 3h"
);

const multiples = empty.slots
  .filter((s): s is number => s !== null)
  .sort((a, b) => a - b)
  .map((s) => (s - t0) / SPARK_REGEN_MS);
assert(
  JSON.stringify(multiples) === JSON.stringify([1, 2, 3, 4]),
  `empty bar chained at 3/6/9/12h, got ${JSON.stringify(multiples)}`
);

const parallel = normalizeSparkState(
  {
    max: 4,
    regenMs: SPARK_REGEN_MS,
    slots: [
      t0 + SPARK_REGEN_MS,
      t0 + SPARK_REGEN_MS,
      t0 + SPARK_REGEN_MS,
      t0 + SPARK_REGEN_MS,
    ],
  },
  t0
);
const migrated = parallel.slots
  .filter((s): s is number => s !== null)
  .sort((a, b) => a - b)
  .map((s) => (s - t0) / SPARK_REGEN_MS);
assert(
  JSON.stringify(migrated) === JSON.stringify([1, 2, 3, 4]),
  `parallel timers must rechain, got ${JSON.stringify(migrated)}`
);

assert(
  shouldPersistSparkMigration(
    {
      max: 4,
      regenMs: SPARK_REGEN_MS,
      slots: Array.from({ length: 4 }, () => t0 + SPARK_REGEN_MS),
    },
    parallel,
    t0
  ),
  "rechain must persist"
);

const oldThree = coerceSparkState({
  max: 3,
  regenMs: SPARK_REGEN_MS,
  slots: [null, null, null],
});
assert(oldThree.max === 4, "existing users upgrade to 4");
assert(oldThree.slots.length === 4, "existing users gain a 4th slot");
assert(
  rawSparkNeedsUpgrade({ max: 3, regenMs: SPARK_REGEN_MS, slots: [null, null, null] }),
  "raw max=3 needs upgrade"
);
assert(
  !rawSparkNeedsUpgrade({
    max: 4,
    regenMs: SPARK_REGEN_MS,
    slots: [null, null, null, null],
  }),
  "max=4 does not need upgrade"
);

console.log("OK: sequential spark refill assertions passed");
