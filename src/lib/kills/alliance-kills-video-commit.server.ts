import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { listAllianceDataBatches } from "@/lib/data-management/batch-ledger.server";
import { parseScoreNumber } from "@/lib/video/normalize-rows";
import {
  getCommanderIdForMember,
  revertLatestVideoParseKillsIfStillCurrent,
  upsertCommanderKills,
} from "@/lib/kills/repository";
import { ALLIANCE_KILLS_VIDEO_SCORE_TARGET } from "@/lib/video/score-targets";

export type AllianceKillsVideoSubmitRow = {
  memberId: string;
  memberName: string;
  score: string;
};

export type PriorAllianceKillsVideoMember = {
  memberId: string;
  /** Parsed-row score string from the batch about to be replaced. */
  score: string | null;
};

export type CommitAllianceKillsFromVideoResult = {
  updated: number;
  unchanged: number;
  skippedUnlinked: number;
  skippedInvalid: number;
  reverted: number;
};

async function collectAllianceKillsVideoMembersFromBatches(input: {
  allianceId: string;
  /** When set, only batches for this recorded date. */
  recordedDate?: string;
  /** When set, only batches with recordedDate strictly after this date. */
  afterRecordedDate?: string;
}): Promise<PriorAllianceKillsVideoMember[]> {
  const batches = await listAllianceDataBatches({
    allianceId: input.allianceId,
    scoreTarget: ALLIANCE_KILLS_VIDEO_SCORE_TARGET,
    status: "active",
  });
  const matching = batches.filter((batch) => {
    if ((batch.contextJson.eventId ?? null) != null) return false;
    if (
      input.recordedDate != null &&
      batch.recordedDate !== input.recordedDate
    ) {
      return false;
    }
    if (
      input.afterRecordedDate != null &&
      batch.recordedDate <= input.afterRecordedDate
    ) {
      return false;
    }
    return true;
  });

  const byMemberId = new Map<string, PriorAllianceKillsVideoMember>();
  const db = getDb();
  for (const batch of matching) {
    if (!batch.parseSessionId) continue;
    const rows = await db
      .select({
        memberId: schema.parsedRows.memberId,
        score: schema.parsedRows.score,
      })
      .from(schema.parsedRows)
      .where(
        and(
          eq(schema.parsedRows.parseSessionId, batch.parseSessionId),
          eq(schema.parsedRows.deleted, 0),
          isNotNull(schema.parsedRows.memberId),
        ),
      );
    for (const row of rows) {
      if (!row.memberId) continue;
      // Prefer first score seen; later batches in list order are older (ledger
      // sorts by recordedDate desc) so keep the newest score when scanning
      // afterRecordedDate.
      if (!byMemberId.has(row.memberId)) {
        byMemberId.set(row.memberId, {
          memberId: row.memberId,
          score: row.score,
        });
      }
    }
  }
  return [...byMemberId.values()];
}

/**
 * Member IDs still active on prior KillScore batches for this recorded date,
 * before replace soft-deletes those ledger rows.
 */
export async function listPriorAllianceKillsVideoMemberIds(input: {
  allianceId: string;
  recordedDate: string;
}): Promise<string[]> {
  const members = await listPriorAllianceKillsVideoMembers(input);
  return members.map((member) => member.memberId);
}

/**
 * Members + scores on prior KillScore batches for this recorded date,
 * before replace soft-deletes those ledger rows.
 */
export async function listPriorAllianceKillsVideoMembers(input: {
  allianceId: string;
  recordedDate: string;
}): Promise<PriorAllianceKillsVideoMember[]> {
  return collectAllianceKillsVideoMembersFromBatches({
    allianceId: input.allianceId,
    recordedDate: input.recordedDate,
  });
}

/**
 * Members present on any active KillScore batch recorded after `recordedDate`.
 * Used so re-submitting an older day cannot revert a newer day's HQ kills.
 */
export async function listLaterAllianceKillsVideoMemberIds(input: {
  allianceId: string;
  recordedDate: string;
}): Promise<Set<string>> {
  const members = await collectAllianceKillsVideoMembersFromBatches({
    allianceId: input.allianceId,
    afterRecordedDate: input.recordedDate,
  });
  return new Set(members.map((member) => member.memberId));
}

function parseExpectedKillsTotal(score: string | null | undefined): number | null {
  if (score == null || score.trim() === "") return null;
  try {
    const total = parseScoreNumber(score);
    if (!Number.isFinite(total) || total < 0) return null;
    return Math.round(total);
  } catch {
    return null;
  }
}

/**
 * Dual-write Strength Ranking → Kills totals into HQ commander history after
 * Ashed KillScore submit. Uses source `video_parse` and marks events synced so
 * outbound Member.current_kills PUTs are not queued (KillScore already wrote).
 */
export async function commitAllianceKillsFromVideoSubmit(input: {
  allianceId: string;
  hqUserId?: string | null;
  rows: AllianceKillsVideoSubmitRow[];
  /** Recorded date of the batch being submitted (YYYY-MM-DD). */
  recordedDate?: string;
  /**
   * Members present on the previous active batch for this date.
   * Prefer {@link previousMembers} when scores are available.
   */
  previousMemberIds?: string[];
  /** Prior-batch members with scores — enables safe cross-date revert guards. */
  previousMembers?: PriorAllianceKillsVideoMember[];
}): Promise<CommitAllianceKillsFromVideoResult> {
  let updated = 0;
  let unchanged = 0;
  let skippedUnlinked = 0;
  let skippedInvalid = 0;
  let reverted = 0;

  const keptMemberIds = new Set(
    input.rows.map((row) => row.memberId).filter(Boolean),
  );

  for (const row of input.rows) {
    let total: number;
    try {
      total = parseScoreNumber(row.score);
    } catch {
      skippedInvalid += 1;
      continue;
    }
    if (!Number.isFinite(total) || total < 0) {
      skippedInvalid += 1;
      continue;
    }

    const commanderId = await getCommanderIdForMember(
      input.allianceId,
      row.memberId,
    );
    if (!commanderId) {
      skippedUnlinked += 1;
      continue;
    }

    const changed = await upsertCommanderKills({
      commanderId,
      total: Math.round(total),
      allianceId: input.allianceId,
      ashedMemberId: row.memberId,
      memberName: row.memberName,
      source: "video_parse",
      hqUserId: input.hqUserId ?? null,
      markAshedSynced: true,
    });
    if (changed) {
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  const previousMembers: PriorAllianceKillsVideoMember[] =
    input.previousMembers ??
    (input.previousMemberIds ?? []).map((memberId) => ({
      memberId,
      score: null,
    }));

  const laterMemberIds =
    input.recordedDate != null
      ? await listLaterAllianceKillsVideoMemberIds({
          allianceId: input.allianceId,
          recordedDate: input.recordedDate,
        })
      : new Set<string>();

  for (const prior of previousMembers) {
    if (keptMemberIds.has(prior.memberId)) continue;
    // A newer day's active KillScore still includes this member — HQ current
    // kills belong to that later submit, not the batch being replaced.
    if (laterMemberIds.has(prior.memberId)) continue;

    const commanderId = await getCommanderIdForMember(
      input.allianceId,
      prior.memberId,
    );
    if (!commanderId) continue;

    const expectedTotal = parseExpectedKillsTotal(prior.score);
    if (
      await revertLatestVideoParseKillsIfStillCurrent(
        commanderId,
        expectedTotal ?? undefined,
      )
    ) {
      reverted += 1;
    }
  }

  return {
    updated,
    unchanged,
    skippedUnlinked,
    skippedInvalid,
    reverted,
  };
}
