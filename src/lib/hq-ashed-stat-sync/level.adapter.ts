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
  getCommanderLevelState,
  upsertCommanderLevel,
} from "@/lib/member-level/repository";
import { clampMemberHqLevel } from "@/lib/members/member-level.shared";

export const levelStatSyncAdapter: StatSyncAdapter = {
  stat: "level",
  ashedField: "level",

  async getHqCurrent(commanderId) {
    const state = await getCommanderLevelState(commanderId);
    const meta = await loadLatestNonDiscardedEventMeta("level", commanderId);
    return {
      total: state?.memberLevel ?? null,
      updatedAt: state?.levelUpdatedAt ?? meta.createdAt,
      latestSource: meta.source,
      pendingUnsyncedSelfReport: pendingUnsyncedFromMeta(meta),
      latestEventId: meta.eventId,
    };
  },

  async applyAshedOnHq(input) {
    return upsertCommanderLevel({
      commanderId: input.commanderId,
      total: clampMemberHqLevel(input.total),
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
        level: clampMemberHqLevel(total),
        recorded_date,
      }),
    });
  },

  async markEventSynced(eventId) {
    const db = getDb();
    await db
      .update(schema.commanderLevelEvents)
      .set({ ashedSyncedAt: new Date() })
      .where(eq(schema.commanderLevelEvents.id, eventId));
  },

  async markEventDiscarded(eventId) {
    const db = getDb();
    await db
      .update(schema.commanderLevelEvents)
      .set({ discardedAt: new Date() })
      .where(eq(schema.commanderLevelEvents.id, eventId));
  },

  async revertHqToPrevious(input) {
    const db = getDb();
    let discardTarget:
      | (typeof schema.commanderLevelEvents.$inferSelect)
      | undefined;

    if (input.eventIdToDiscard) {
      [discardTarget] = await db
        .select()
        .from(schema.commanderLevelEvents)
        .where(eq(schema.commanderLevelEvents.id, input.eventIdToDiscard))
        .limit(1);
    } else {
      [discardTarget] = await db
        .select()
        .from(schema.commanderLevelEvents)
        .where(
          and(
            eq(schema.commanderLevelEvents.commanderId, input.commanderId),
            isNull(schema.commanderLevelEvents.discardedAt),
          ),
        )
        .orderBy(desc(schema.commanderLevelEvents.createdAt))
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
          memberLevel: null,
          levelUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.commanders.id, input.commanderId));
      return null;
    }
    await upsertCommanderLevel({
      commanderId: input.commanderId,
      total: clampMemberHqLevel(restoreTotal),
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      source: "officer_override",
      hqUserId: input.hqUserId,
    });
    return clampMemberHqLevel(restoreTotal);
  },

  async listPendingOutbound(allianceId) {
    const db = getDb();
    const rows = await db
      .select({
        eventId: schema.commanderLevelEvents.id,
        commanderId: schema.commanderLevelEvents.commanderId,
        total: schema.commanderLevelEvents.total,
        source: schema.commanderLevelEvents.source,
        createdAt: schema.commanderLevelEvents.createdAt,
        ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
        memberName: schema.allianceMembers.currentName,
      })
      .from(schema.commanderLevelEvents)
      .innerJoin(
        schema.commanderAllianceMemberships,
        and(
          eq(
            schema.commanderAllianceMemberships.commanderId,
            schema.commanderLevelEvents.commanderId,
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
          eq(schema.commanderLevelEvents.allianceId, allianceId),
          isNull(schema.commanderLevelEvents.ashedSyncedAt),
          isNull(schema.commanderLevelEvents.discardedAt),
          inArray(
            schema.commanderLevelEvents.source,
            [...PROTECTED_HQ_STAT_SOURCES, "roster_import", "manual"],
          ),
        ),
      )
      .orderBy(desc(schema.commanderLevelEvents.createdAt));

    const seen = new Set<string>();
    const out = [];
    for (const row of rows) {
      if (seen.has(row.commanderId)) continue;
      seen.add(row.commanderId);
      if (!row.ashedMemberId) continue;
      out.push({
        stat: "level" as const,
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
