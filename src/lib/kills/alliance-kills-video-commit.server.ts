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

export type CommitAllianceKillsFromVideoResult = {
  updated: number;
  unchanged: number;
  skippedUnlinked: number;
  skippedInvalid: number;
  reverted: number;
};

/**
 * Member IDs still active on prior KillScore batches for this recorded date,
 * before replace soft-deletes those ledger rows.
 */
export async function listPriorAllianceKillsVideoMemberIds(input: {
  allianceId: string;
  recordedDate: string;
}): Promise<string[]> {
  const batches = await listAllianceDataBatches({
    allianceId: input.allianceId,
    scoreTarget: ALLIANCE_KILLS_VIDEO_SCORE_TARGET,
    status: "active",
  });
  const matching = batches.filter((batch) => {
    if (batch.recordedDate !== input.recordedDate) return false;
    return (batch.contextJson.eventId ?? null) == null;
  });

  const memberIds = new Set<string>();
  const db = getDb();
  for (const batch of matching) {
    if (!batch.parseSessionId) continue;
    const rows = await db
      .select({ memberId: schema.parsedRows.memberId })
      .from(schema.parsedRows)
      .where(
        and(
          eq(schema.parsedRows.parseSessionId, batch.parseSessionId),
          eq(schema.parsedRows.deleted, 0),
          isNotNull(schema.parsedRows.memberId),
        ),
      );
    for (const row of rows) {
      if (row.memberId) memberIds.add(row.memberId);
    }
  }
  return [...memberIds];
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
  /** Ashed member IDs present on the previous active batch for this date. */
  previousMemberIds?: string[];
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

  for (const memberId of input.previousMemberIds ?? []) {
    if (keptMemberIds.has(memberId)) continue;
    const commanderId = await getCommanderIdForMember(
      input.allianceId,
      memberId,
    );
    if (!commanderId) continue;
    if (await revertLatestVideoParseKillsIfStillCurrent(commanderId)) {
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
