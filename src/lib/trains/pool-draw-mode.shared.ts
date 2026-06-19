import type { PoolType } from "@/lib/trains/types";

/** Pools that assign the next eligible member by sequence position (not random). */
export function poolUsesSequenceDraw(poolType: PoolType): boolean {
  return poolType === "r4_plus";
}
