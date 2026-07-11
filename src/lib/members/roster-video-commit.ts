import "server-only";

import { eq } from "drizzle-orm";

import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import {
  commitRosterImport,
  type RosterImportCommitResult,
} from "@/lib/native-alliance/roster-commit";
import { listAllianceMembers } from "@/lib/members/roster.server";
import {
  computeProjectedRosterRankCounts,
  validateRosterRankQuota,
} from "@/lib/members/roster-rank-quota.shared";
import { parsePowerLevelString } from "@/lib/video/roster-extract";

export type CommitRosterFromVideoInput = {
  allianceId: string;
  sessionId: string;
  hqUserId: string;
  parseSessionId: string;
  markAbsentInactive?: boolean;
  ashedConnection?: ParsedConnection | null;
};

function normalizeMemberLevel(value: number | null): number | null {
  if (value == null || value < 1) return null;
  return Math.round(value);
}

export async function commitRosterFromVideoJob(
  input: CommitRosterFromVideoInput,
): Promise<RosterImportCommitResult> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, input.parseSessionId));

  const activeRows = rows.filter((row) => row.deleted !== 1);

  const commitRows = activeRows
    .map((row) => {
      const allianceRank = row.allianceRank;
      if (allianceRank == null || allianceRank < 1 || allianceRank > 5) {
        return null;
      }
      const name = row.memberName ?? row.ocrName;
      const { powerLevel } = parsePowerLevelString(row.powerLevel ?? null);
      return {
        extractedName: name,
        matchMemberId: row.memberId,
        allianceRank,
        allianceRankTitle: null,
        powerLevel: powerLevel ?? row.powerLevel,
        memberLevel: normalizeMemberLevel(row.memberLevel),
        profession: row.profession,
        status: "active" as const,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (commitRows.length === 0) {
    throw new Error(
      "No roster rows with a valid alliance rank to commit. Review extracted ranks and try again.",
    );
  }

  const hqMembers = await listAllianceMembers(input.allianceId);
  const existingForQuota = hqMembers.map((member) => ({
    ashedMemberId: member.ashedMemberId,
    allianceRank: member.allianceRank,
    status: member.status,
  }));

  const quotaCounts = computeProjectedRosterRankCounts(
    existingForQuota,
    commitRows.map((row) => ({
      matchMemberId: row.matchMemberId,
      allianceRank: row.allianceRank,
    })),
  );

  const quotaErrors = validateRosterRankQuota(quotaCounts);
  if (quotaErrors.length > 0) {
    throw new Error(
      `Roster rank limits not satisfied: ${quotaErrors.join(", ")}. Adjust ranks in review and try again.`,
    );
  }

  return commitRosterImport({
    allianceId: input.allianceId,
    sessionId: input.sessionId,
    hqUserId: input.hqUserId,
    rows: commitRows,
    markAbsentInactive: input.markAbsentInactive,
    source: "video_parse",
    ashedConnection: input.ashedConnection,
  });
}
