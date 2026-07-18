import "server-only";

import { parseScoreNumber } from "@/lib/video/normalize-rows";
import {
  getCommanderIdForMember,
  upsertCommanderKills,
} from "@/lib/kills/repository";

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
};

/**
 * Dual-write Strength Ranking → Kills totals into HQ commander history after
 * Ashed KillScore submit. Uses source `video_parse` so existing anomaly /
 * outbound-sync paths continue to apply.
 */
export async function commitAllianceKillsFromVideoSubmit(input: {
  allianceId: string;
  hqUserId?: string | null;
  rows: AllianceKillsVideoSubmitRow[];
}): Promise<CommitAllianceKillsFromVideoResult> {
  let updated = 0;
  let unchanged = 0;
  let skippedUnlinked = 0;
  let skippedInvalid = 0;

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
    });
    if (changed) {
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  return { updated, unchanged, skippedUnlinked, skippedInvalid };
}
