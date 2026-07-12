import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import {
  loadLatestNonDiscardedEventMeta,
  pendingUnsyncedFromMeta,
} from "@/lib/hq-ashed-stat-sync/inbound";
import type { StatSyncAdapter } from "@/lib/hq-ashed-stat-sync/types";
import {
  getCommanderKillsState,
  upsertCommanderKills,
} from "@/lib/kills/repository";

export const killsStatSyncAdapter: StatSyncAdapter = {
  stat: "kills",
  ashedField: "current_kills",

  async getHqCurrent(commanderId) {
    const state = await getCommanderKillsState(commanderId);
    const meta = await loadLatestNonDiscardedEventMeta("kills", commanderId);
    return {
      total: state?.currentKills ?? null,
      updatedAt: state?.killsUpdatedAt ?? meta.createdAt,
      latestSource: meta.source,
      pendingUnsyncedSelfReport: pendingUnsyncedFromMeta(meta),
      latestEventId: meta.eventId,
    };
  },

  async applyAshedOnHq(input) {
    return upsertCommanderKills({
      commanderId: input.commanderId,
      total: input.total,
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
        current_kills: total,
        recorded_date,
      }),
    });
  },

  async markEventSynced(eventId) {
    const db = getDb();
    await db
      .update(schema.commanderKillsEvents)
      .set({ ashedSyncedAt: new Date() })
      .where(eq(schema.commanderKillsEvents.id, eventId));
  },

  async markEventDiscarded(eventId) {
    const db = getDb();
    await db
      .update(schema.commanderKillsEvents)
      .set({ discardedAt: new Date() })
      .where(eq(schema.commanderKillsEvents.id, eventId));
  },

  async revertHqToPrevious(input) {
    const db = getDb();
    const events = await db
      .select()
      .from(schema.commanderKillsEvents)
      .where(
        and(
          eq(schema.commanderKillsEvents.commanderId, input.commanderId),
          isNull(schema.commanderKillsEvents.discardedAt),
        ),
      )
      .orderBy(desc(schema.commanderKillsEvents.createdAt))
      .limit(2);

    const latest = events[0];
    if (!latest) return null;
    await this.markEventDiscarded(latest.id);
    const previous = events[1];
    const restoreTotal = previous?.total ?? latest.previousTotal;
    if (restoreTotal == null || !(restoreTotal > 0)) {
      await db
        .update(schema.commanders)
        .set({
          currentKills: null,
          killsUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.commanders.id, input.commanderId));
      return null;
    }
    await upsertCommanderKills({
      commanderId: input.commanderId,
      total: restoreTotal,
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
        eventId: schema.commanderKillsEvents.id,
        commanderId: schema.commanderKillsEvents.commanderId,
        total: schema.commanderKillsEvents.total,
        source: schema.commanderKillsEvents.source,
        createdAt: schema.commanderKillsEvents.createdAt,
        ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
        memberName: schema.allianceMembers.currentName,
      })
      .from(schema.commanderKillsEvents)
      .innerJoin(
        schema.commanderAllianceMemberships,
        and(
          eq(
            schema.commanderAllianceMemberships.commanderId,
            schema.commanderKillsEvents.commanderId,
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
          eq(schema.commanderKillsEvents.allianceId, allianceId),
          isNull(schema.commanderKillsEvents.ashedSyncedAt),
          isNull(schema.commanderKillsEvents.discardedAt),
        ),
      )
      .orderBy(desc(schema.commanderKillsEvents.createdAt));

    const seen = new Set<string>();
    const out = [];
    for (const row of rows) {
      if (seen.has(row.commanderId)) continue;
      seen.add(row.commanderId);
      if (!row.ashedMemberId) continue;
      out.push({
        stat: "kills" as const,
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
