/**
 * Shuffle USDC daily-budget client. Uses ShuffleBudgetDO when bound;
 * callers fall back to RTDB ETag transactions in `next dev`.
 */

import { getWorkerEnv, type ShuffleBudgetStub } from "@/lib/worker-env";

export async function getShuffleBudgetStub(
  dayKey: string
): Promise<ShuffleBudgetStub | null> {
  const env = await getWorkerEnv();
  const ns = env?.SHUFFLE_BUDGET_DO;
  if (!ns) return null;
  try {
    return ns.get(ns.idFromName(dayKey));
  } catch {
    return null;
  }
}
