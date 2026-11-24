import "server-only";

import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { loadAllianceRow } from "@/lib/members/game-roster";
import { previewEventEligibility } from "@/lib/trains/event-eligibility.server";
import { fetchNativeVrTopScorers } from "@/lib/trains/native-scores.server";
import {
  resolveMemberAtNumberedRank,
  resolveNumberedSpinPoolSize,
} from "@/lib/trains/numbered-spin.shared";
import {
  parseConductorRule,
  parseVipRule,
  type ConductorRule,
  type VipRule,
} from "@/lib/trains/rules/catalog.shared";
import { fetchAllianceVsTopScorersForTrainDate } from "@/lib/trains/vs-scores.server";
import { vsScoreReferenceDate } from "@/lib/trains/vs-week-days.shared";

export type NumberedSpinBackfillSource = "vs" | "vr" | "event";

export type NumberedSpinBackfillResult = {
  conductorBackfilled: number;
  vipBackfilled: number;
};

function ruleMatchesSource(
  rule: ConductorRule | VipRule | null,
  source: NumberedSpinBackfillSource,
  options?: {
    trainDate: string;
    leadDays: number;
    vsRecordedDate?: string | null;
    occurrenceId?: string | null;
  },
): boolean {
  if (!rule) return false;
  if (resolveNumberedSpinPoolSize(rule) === null) return false;

  if (source === "vs") {
    if (rule.kind !== "vs_top_n") return false;
    if (options?.vsRecordedDate) {
      return (
        vsScoreReferenceDate(options.trainDate, options.leadDays) ===
        options.vsRecordedDate
      );
    }
    return true;
  }

  if (source === "vr") {
    return rule.kind === "vr_top_n";
  }

  if (source === "event") {
    if (rule.kind !== "event_scores") return false;
    if (options?.occurrenceId && rule.source.occurrenceId) {
      return rule.source.occurrenceId === options.occurrenceId;
    }
    return true;
  }

  return false;
}

async function loadRankedCandidatesForRule(input: {
  allianceId: string;
  trainDate: string;
  role: "conductor" | "vip";
  rule: ConductorRule | VipRule;
  poolSize: number;
  leadDays: number;
}): Promise<Array<{ memberId: string; memberName: string }>> {
  if (input.rule.kind === "vs_top_n") {
    // Fetch one extra slot for VIP so excluding the conductor still yields topN.
    const limit = input.role === "vip" ? input.poolSize + 1 : input.poolSize;
    return fetchAllianceVsTopScorersForTrainDate(
      input.allianceId,
      input.trainDate,
      limit,
      input.leadDays,
    );
  }

  if (input.rule.kind === "vr_top_n") {
    return fetchNativeVrTopScorers(input.allianceId, input.poolSize);
  }

  if (input.rule.kind === "event_scores") {
    const preview = await previewEventEligibility(
      { allianceId: input.allianceId, hqUserId: null, sessionId: null },
      {
        date: input.trainDate,
        role: input.role,
        rule: input.rule,
      },
    );
    if (!preview.eligibility.ok) return [];
    return preview.eligibility.candidates.map((c) => ({
      memberId: c.memberId,
      memberName: c.memberName ?? c.memberId,
    }));
  }

  return [];
}

/**
 * Auto-backfill unresolved numbered-spin conductor and/or VIP slots when scores
 * are uploaded or event evidence is committed.
 *
 * Idempotent and race-safe: updates only rows whose target member column is
 * still NULL (and for VIP, `noVip = 0`), never overwriting an already-assigned
 * or locked member.
 */
export async function backfillNumberedSpinsForScoreSource(input: {
  allianceId: string;
  source: NumberedSpinBackfillSource;
  vsRecordedDate?: string | null;
  occurrenceId?: string | null;
}): Promise<NumberedSpinBackfillResult> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.allianceId, input.allianceId),
        or(
          and(
            isNull(schema.trainConductorRecords.conductorMemberId),
            isNotNull(schema.trainConductorRecords.conductorNumberedRank),
          ),
          and(
            isNull(schema.trainConductorRecords.vipMemberId),
            eq(schema.trainConductorRecords.noVip, 0),
            isNotNull(schema.trainConductorRecords.vipNumberedRank),
          ),
        ),
      ),
    );

  if (rows.length === 0) {
    return { conductorBackfilled: 0, vipBackfilled: 0 };
  }

  const allianceRow =
    input.source === "vs" ? await loadAllianceRow(input.allianceId) : null;
  const leadDays = allianceRow?.trainConductorLeadTimeDays ?? 0;

  let conductorBackfilled = 0;
  let vipBackfilled = 0;

  for (const row of rows) {
    let effectiveConductorMemberId = row.conductorMemberId;

    // 1. Conductor backfill
    if (
      !row.conductorMemberId &&
      row.conductorNumberedRank != null &&
      row.conductorNumberedPoolSize != null
    ) {
      const conductorRule = parseConductorRule(row.conductorRule);
      if (
        conductorRule &&
        ruleMatchesSource(conductorRule, input.source, {
          trainDate: row.date,
          leadDays,
          vsRecordedDate: input.vsRecordedDate,
          occurrenceId: input.occurrenceId,
        })
      ) {
        const ranked = await loadRankedCandidatesForRule({
          allianceId: input.allianceId,
          trainDate: row.date,
          role: "conductor",
          rule: conductorRule,
          poolSize: row.conductorNumberedPoolSize,
          leadDays,
        });
        const winner = resolveMemberAtNumberedRank(
          ranked,
          row.conductorNumberedRank,
        );
        if (winner) {
          const updated = await db
            .update(schema.trainConductorRecords)
            .set({
              conductorMemberId: winner.memberId,
              conductorMemberName: winner.memberName,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.trainConductorRecords.id, row.id),
                isNull(schema.trainConductorRecords.conductorMemberId),
              ),
            )
            .returning({ id: schema.trainConductorRecords.id });

          if (updated.length > 0) {
            conductorBackfilled += 1;
            effectiveConductorMemberId = winner.memberId;
          }
        }
      }
    }

    // 2. VIP backfill
    if (
      !row.vipMemberId &&
      row.noVip === 0 &&
      row.vipNumberedRank != null &&
      row.vipNumberedPoolSize != null
    ) {
      const vipRule = parseVipRule(row.vipRule);
      if (
        vipRule &&
        ruleMatchesSource(vipRule, input.source, {
          trainDate: row.date,
          leadDays,
          vsRecordedDate: input.vsRecordedDate,
          occurrenceId: input.occurrenceId,
        })
      ) {
        const ranked = await loadRankedCandidatesForRule({
          allianceId: input.allianceId,
          trainDate: row.date,
          role: "vip",
          rule: vipRule,
          poolSize: row.vipNumberedPoolSize,
          leadDays,
        });
        const winner = resolveMemberAtNumberedRank(
          ranked,
          row.vipNumberedRank,
          effectiveConductorMemberId,
        );
        if (winner) {
          const updated = await db
            .update(schema.trainConductorRecords)
            .set({
              vipMemberId: winner.memberId,
              vipMemberName: winner.memberName,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.trainConductorRecords.id, row.id),
                isNull(schema.trainConductorRecords.vipMemberId),
                eq(schema.trainConductorRecords.noVip, 0),
              ),
            )
            .returning({ id: schema.trainConductorRecords.id });

          if (updated.length > 0) {
            vipBackfilled += 1;
          }
        }
      }
    }
  }

  return { conductorBackfilled, vipBackfilled };
}
