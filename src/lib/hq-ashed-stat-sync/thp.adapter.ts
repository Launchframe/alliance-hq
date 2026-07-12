import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import {
  loadLatestNonDiscardedEventMeta,
  pendingUnsyncedFromMeta,
} from "@/lib/hq-ashed-stat-sync/inbound";
import { PROTECTED_HQ_STAT_SOURCES } from "@/lib/hq-ashed-stat-sync/policy";
import { resolveRestoreTotalAfterDiscardEvent } from "@/lib/hq-ashed-stat-sync/revert.shared";
import type { StatSyncAdapter } from "@/lib/hq-ashed-stat-sync/types";
import {
  getCommanderMembershipInAlliance,
  getCommanderThpState,
  upsertCommanderThp,
} from "@/lib/thp/repository";

export const thpStatSyncAdapter: StatSyncAdapter = {
  stat: "thp",
  ashedField: "current_total_hero_power",

  async getHqCurrent(commanderId) {
    const state = await getCommanderThpState(commanderId);
    const meta = await loadLatestNonDiscardedEventMeta("thp", commanderId);
    return {
      total: state?.currentTotalHeroPower ?? null,
      updatedAt: state?.thpUpdatedAt ?? meta.createdAt,
      latestSource: meta.source,
      pendingUnsyncedSelfReport: pendingUnsyncedFromMeta(meta),
      latestEventId: meta.eventId,
    };
  },

  async applyAshedOnHq(input) {
    return upsertCommanderThp({
      commanderId: input.commanderId,
      total: input.total,
      breakdown: null,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      source: input.source,
      hqUserId: input.hqUserId,
    });
  },

  async putToAshed(connection: ParsedConnection, ashedMemberId, total) {
    const recorded_date = new Date().toISOString().slice(0, 10);
    await base44Json(connection, `/entities/Member/${ashedMemberId}`, {
      method: "PUT",
      body: JSON.stringify({
        current_total_hero_power: total,
        recorded_date,
      }),
    });
  },

  async markEventSynced(eventId) {
    const db = getDb();
    await db
      .update(schema.commanderThpEvents)
      .set({ ashedSyncedAt: new Date() })
      .where(eq(schema.commanderThpEvents.id, eventId));
  },

  async markEventDiscarded(eventId) {
    const db = getDb();
    await db
      .update(schema.commanderThpEvents)
      .set({ discardedAt: new Date() })
      .where(eq(schema.commanderThpEvents.id, eventId));
  },

  async revertHqToPrevious(input) {
    const db = getDb();
    let discardTarget:
      | (typeof schema.commanderThpEvents.$inferSelect)
      | undefined;

    if (input.eventIdToDiscard) {
      [discardTarget] = await db
        .select()
        .from(schema.commanderThpEvents)
        .where(eq(schema.commanderThpEvents.id, input.eventIdToDiscard))
        .limit(1);
    } else {
      [discardTarget] = await db
        .select()
        .from(schema.commanderThpEvents)
        .where(
          and(
            eq(schema.commanderThpEvents.commanderId, input.commanderId),
            isNull(schema.commanderThpEvents.discardedAt),
          ),
        )
        .orderBy(desc(schema.commanderThpEvents.createdAt))
        .limit(1);
    }

    if (!discardTarget) return null;
    if (discardTarget.discardedAt == null) {
      await this.markEventDiscarded(discardTarget.id);
    }

    const restoreTotal = resolveRestoreTotalAfterDiscardEvent({
      previousTotal: discardTarget.previousTotal,
    });
    if (restoreTotal == null) {
      await db
        .update(schema.commanders)
        .set({
          currentTotalHeroPower: null,
          currentThpBreakdown: null,
          thpUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.commanders.id, input.commanderId));
      return null;
    }
    await upsertCommanderThp({
      commanderId: input.commanderId,
      total: restoreTotal,
      breakdown: null,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      source: "officer_override",
      hqUserId: input.hqUserId,
    });
    return restoreTotal;
  },

  async listPendingOutbound(allianceId) {
    const db = getDb();
    const rows = await db
      .select({
        eventId: schema.commanderThpEvents.id,
        commanderId: schema.commanderThpEvents.commanderId,
        total: schema.commanderThpEvents.total,
        source: schema.commanderThpEvents.source,
        createdAt: schema.commanderThpEvents.createdAt,
        ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
        memberName: schema.allianceMembers.currentName,
      })
      .from(schema.commanderThpEvents)
      .innerJoin(
        schema.commanderAllianceMemberships,
        and(
          eq(
            schema.commanderAllianceMemberships.commanderId,
            schema.commanderThpEvents.commanderId,
          ),
          eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        ),
      )
      .leftJoin(
        schema.allianceMembers,
        and(
          eq(schema.allianceMembers.allianceId, allianceId),
          eq(
            schema.allianceMembers.ashedMemberId,
            schema.commanderAllianceMemberships.ashedMemberId,
          ),
        ),
      )
      .where(
        and(
          eq(schema.commanderThpEvents.allianceId, allianceId),
          isNull(schema.commanderThpEvents.ashedSyncedAt),
          isNull(schema.commanderThpEvents.discardedAt),
          inArray(
            schema.commanderThpEvents.source,
            [...PROTECTED_HQ_STAT_SOURCES],
          ),
        ),
      )
      .orderBy(desc(schema.commanderThpEvents.createdAt));

    // Deduplicate to latest pending event per commander
    const seen = new Set<string>();
    const out = [];
    for (const row of rows) {
      if (seen.has(row.commanderId)) continue;
      seen.add(row.commanderId);
      if (!row.ashedMemberId) continue;
      out.push({
        stat: "thp" as const,
        commanderId: row.commanderId,
        ashedMemberId: row.ashedMemberId,
        memberName: row.memberName ?? row.ashedMemberId,
        hqTotal: row.total,
        ashedTotal: null,
        hqSource: row.source,
        hqUpdatedAt: row.createdAt.toISOString(),
        eventId: row.eventId,
        reason: "pending_outbound" as const,
      });
    }
    return out;
  },
};

export async function getThpMembershipForReview(
  commanderId: string,
  allianceId: string,
) {
  return getCommanderMembershipInAlliance(commanderId, allianceId);
}
