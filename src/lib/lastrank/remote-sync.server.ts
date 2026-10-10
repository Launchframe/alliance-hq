import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import {
  buildLastRankSyncSummary,
  LASTRANK_REMOTE_SYNC_VERSION,
  listUnappliedRemoteMappings,
  type LastRankRemoteApplyRequest,
  type LastRankRemotePlan,
  type LastRankRemotePrompt,
} from "@/lib/lastrank/remote-sync.shared";
import {
  syncLastRankAlliance,
  type LastRankSyncApplyCounts,
} from "@/lib/lastrank/sync-alliance.server";
import type { LastRankSyncTarget } from "@/lib/lastrank/sync-registry.shared";
import { listActiveMemberIdsNotInSet } from "@/lib/lastrank/sync-upsert.server";

/** Shorter secrets are treated as unset so a placeholder cannot open the route. */
export const LASTRANK_SYNC_TOKEN_MIN_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Maintainer CLI auth for the remote LastRank sync routes. Fails closed when
 * `LASTRANK_SYNC_TOKEN` is unset or too short. Session cookies never grant access.
 */
export function isLastRankRemoteSyncAuthorized(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const expected = env.LASTRANK_SYNC_TOKEN?.trim() ?? "";
  if (expected.length < LASTRANK_SYNC_TOKEN_MIN_LENGTH) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (\S+)$/.exec(header);
  if (!match) return false;
  return timingSafeEqual(digest(match[1]), digest(expected));
}

/** Dry run: resolves the existing HQ alliance, matches, and collects prompts. Writes nothing. */
export async function planLastRankRemoteSync(
  target: LastRankSyncTarget,
): Promise<LastRankRemotePlan> {
  const prompts: LastRankRemotePrompt[] = [];
  const result = await syncLastRankAlliance({
    target,
    apply: false,
    allowAllianceCreate: false,
    interactivePrompt: async (ctx) => {
      prompts.push({
        publicId: ctx.publicId,
        lastRankName: ctx.lastRankName,
        profileUrl: ctx.profileUrl,
        unranked: ctx.unranked,
        suggestions: ctx.suggestions.map((s) => ({
          commanderId: s.commanderId,
          name: s.name,
          score: s.score,
          signals: s.signals,
        })),
        remainingHqNames: ctx.remainingHqNames,
      });
      return { kind: "skip" };
    },
  });

  const keep = new Set(result.match.matched.map((row) => row.hq.ashedMemberId));
  const retireCandidates = await listActiveMemberIdsNotInSet(
    result.hqAllianceId,
    keep,
  );

  return {
    version: LASTRANK_REMOTE_SYNC_VERSION,
    target,
    hqAllianceId: result.hqAllianceId,
    ashedDualWrite: result.ashedDualWrite,
    lastRankCount: result.lastRankCount,
    matchedCount: result.match.matched.length,
    rosterDiff: result.rosterDiff,
    prompts,
    retireCandidates: retireCandidates.map((row) => ({
      ashedMemberId: row.ashedMemberId,
      memberName: row.currentName,
    })),
  };
}

/** Replays the operator's answers through the same batched dispatch as the local CLI. */
export async function applyLastRankRemoteSync(request: LastRankRemoteApplyRequest) {
  const answers = new Map(
    request.decisions.map((decision) => [decision.publicId, decision.answer]),
  );
  const retireIds = new Set(request.retireAshedMemberIds);

  const result = await syncLastRankAlliance({
    target: request.target,
    apply: true,
    allowAllianceCreate: false,
    expectedHqAllianceId: request.expectedHqAllianceId,
    createAllUnmatched: request.createAll,
    retireAllUnmatched: request.retireAll,
    hqOnly: request.hqOnly,
    interactivePrompt:
      answers.size > 0
        ? async (ctx) => answers.get(ctx.publicId) ?? { kind: "skip" }
        : undefined,
    retirePrompt:
      !request.retireAll && retireIds.size > 0
        ? async (ctx) => retireIds.has(ctx.ashedMemberId)
        : undefined,
  });

  return {
    summary: buildLastRankSyncSummary<LastRankSyncApplyCounts | null>(result),
    unappliedMappings: listUnappliedRemoteMappings(request.decisions, result.match),
  };
}

export type LastRankRemoteApplyResponse = Awaited<
  ReturnType<typeof applyLastRankRemoteSync>
>;
