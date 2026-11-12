import "server-only";

import type { LastRankAshedWriteContext } from "@/lib/lastrank/ashed-credential.server";
import { syncMemberRankToAshed } from "@/lib/trains/rank-sync";

/** Per-PUT ceiling so one slow Ashed call cannot stall a whole batch. */
export const LASTRANK_ASHED_RANK_TIMEOUT_MS = 10_000;

/**
 * Consecutive failures before a run stops calling Ashed for ranks. Remaining
 * rows keep their HQ write and count as `rankAshedFailed`; the next run retries.
 */
export const LASTRANK_ASHED_RANK_FAILURE_LIMIT = 3;

type RankWriterState = { consecutiveFailures: number; tripped: boolean };

// The write context is loaded once per sync run, so it scopes the breaker.
const runState = new WeakMap<LastRankAshedWriteContext, RankWriterState>();

/** Mirrors a LastRank rank to Ashed. Returns false (never throws) on failure or once tripped. */
export async function writeLastRankRankToAshed(
  ashed: LastRankAshedWriteContext,
  ashedMemberId: string,
  allianceRank: number,
  memberName: string,
): Promise<boolean> {
  let state = runState.get(ashed);
  if (!state) {
    state = { consecutiveFailures: 0, tripped: false };
    runState.set(ashed, state);
  }
  if (state.tripped) return false;

  try {
    await syncMemberRankToAshed(ashed.connection, ashedMemberId, allianceRank, null, {
      signal: AbortSignal.timeout(LASTRANK_ASHED_RANK_TIMEOUT_MS),
    });
    state.consecutiveFailures = 0;
    return true;
  } catch (error) {
    state.consecutiveFailures += 1;
    console.error(
      `[lastrank] Ashed rank PUT failed for ${memberName}: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    if (state.consecutiveFailures >= LASTRANK_ASHED_RANK_FAILURE_LIMIT) {
      state.tripped = true;
      console.error(
        `[lastrank] ${LASTRANK_ASHED_RANK_FAILURE_LIMIT} Ashed rank PUTs failed in a row; skipping Ashed rank writes for the rest of this run.`,
      );
    }
    return false;
  }
}
