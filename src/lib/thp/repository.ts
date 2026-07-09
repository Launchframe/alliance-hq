import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { breakdownsEqual } from "@/lib/thp/breakdown.shared";
import type { ThpEventSource } from "@/lib/thp/constants";
import type { ThpBreakdown } from "@/lib/thp/my-thp.shared";
import { parseStoredThpPending } from "@/lib/thp/pending-state";
import type { ThpPendingState } from "@/lib/thp/types";
import { getServerCalendarDate } from "@/lib/trains/game-time";

const PENDING_TTL_MS = 30 * 60 * 1000;

export async function getCommanderIdForMember(
  allianceId: string,
  ashedMemberId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({
      commanderId: schema.commanderAllianceMemberships.commanderId,
    })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanderAllianceMemberships.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row?.commanderId ?? null;
}

export async function getCommanderThpState(commanderId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      currentTotalHeroPower: schema.commanders.currentTotalHeroPower,
      currentThpBreakdown: schema.commanders.currentThpBreakdown,
      thpUpdatedAt: schema.commanders.thpUpdatedAt,
      primaryName: schema.commanders.primaryName,
    })
    .from(schema.commanders)
    .where(eq(schema.commanders.id, commanderId))
    .limit(1);
  return row ?? null;
}

export async function listAllianceCommanderThpRows(allianceId: string) {
  const db = getDb();
  return db
    .select({
      commanderId: schema.commanders.id,
      total: schema.commanders.currentTotalHeroPower,
    })
    .from(schema.commanders)
    .where(
      and(
        eq(schema.commanders.currentAllianceId, allianceId),
        isNotNull(schema.commanders.currentTotalHeroPower),
      ),
    );
}

export async function listCommanderThpEvents(commanderId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.commanderThpEvents)
    .where(eq(schema.commanderThpEvents.commanderId, commanderId))
    .orderBy(asc(schema.commanderThpEvents.createdAt));
}

export async function listAllianceCommanderThpEvents(allianceId: string) {
  const db = getDb();
  const commanders = await listAllianceCommanderThpRows(allianceId);
  if (commanders.length === 0) {
    return new Map<string, Array<{ commanderId: string; total: number; createdAt: Date }>>();
  }
  const commanderIds = commanders.map((row) => row.commanderId);
  const events = await db
    .select({
      commanderId: schema.commanderThpEvents.commanderId,
      total: schema.commanderThpEvents.total,
      createdAt: schema.commanderThpEvents.createdAt,
    })
    .from(schema.commanderThpEvents)
    .where(inArray(schema.commanderThpEvents.commanderId, commanderIds))
    .orderBy(asc(schema.commanderThpEvents.createdAt));

  const byCommander = new Map<
    string,
    Array<{ commanderId: string; total: number; createdAt: Date }>
  >();
  for (const event of events) {
    const list = byCommander.get(event.commanderId) ?? [];
    list.push(event);
    byCommander.set(event.commanderId, list);
  }
  return byCommander;
}

export async function upsertCommanderThp(input: {
  commanderId: string;
  total: number;
  breakdown?: ThpBreakdown | null;
  allianceId?: string | null;
  ashedMemberId?: string | null;
  memberName?: string | null;
  source: ThpEventSource;
  hqUserId?: string | null;
  discordUserId?: string | null;
}): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const current = await getCommanderThpState(input.commanderId);
  const previousTotal = current?.currentTotalHeroPower ?? null;
  const previousBreakdown = (current?.currentThpBreakdown as ThpBreakdown | null) ?? null;
  const breakdown = input.breakdown ?? null;

  const totalChanged = previousTotal !== input.total;
  const breakdownChanged = !breakdownsEqual(previousBreakdown, breakdown);
  if (!totalChanged && !breakdownChanged) {
    return false;
  }

  await db.insert(schema.commanderThpEvents).values({
    id: nanoid(),
    commanderId: input.commanderId,
    total: input.total,
    breakdown,
    previousTotal,
    source: input.source,
    allianceId: input.allianceId ?? null,
    reportedByHqUserId: input.hqUserId ?? null,
    reportedByDiscordUserId: input.discordUserId ?? null,
    createdAt: now,
  });

  await db
    .update(schema.commanders)
    .set({
      currentTotalHeroPower: input.total,
      currentThpBreakdown: breakdown,
      thpUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.commanders.id, input.commanderId));

  if (input.allianceId && input.ashedMemberId && input.memberName) {
    await db
      .update(schema.allianceMembers)
      .set({
        currentTotalHeroPower: input.total,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.allianceMembers.allianceId, input.allianceId),
          eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
        ),
      );

    const recordedDate = getServerCalendarDate();
    const [existingMemberEvent] = await db
      .select({ id: schema.memberTotalHeroPowerEvents.id })
      .from(schema.memberTotalHeroPowerEvents)
      .where(
        and(
          eq(schema.memberTotalHeroPowerEvents.allianceId, input.allianceId),
          eq(schema.memberTotalHeroPowerEvents.ashedMemberId, input.ashedMemberId),
          eq(schema.memberTotalHeroPowerEvents.recordedDate, recordedDate),
        ),
      )
      .limit(1);

    if (!existingMemberEvent) {
      await db.insert(schema.memberTotalHeroPowerEvents).values({
        id: nanoid(),
        allianceId: input.allianceId,
        ashedMemberId: input.ashedMemberId,
        memberName: input.memberName,
        value: input.total,
        recordedDate,
        source: input.source,
        recordedByHqUserId: input.hqUserId ?? null,
      });
    }
  }

  return true;
}

export async function getHqThpPending(
  allianceId: string,
  hqUserId: string,
): Promise<ThpPendingState | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqThpPending)
    .where(
      and(
        eq(schema.hqThpPending.allianceId, allianceId),
        eq(schema.hqThpPending.hqUserId, hqUserId),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db
      .delete(schema.hqThpPending)
      .where(
        and(
          eq(schema.hqThpPending.allianceId, allianceId),
          eq(schema.hqThpPending.hqUserId, hqUserId),
        ),
      );
    return null;
  }
  return parseStoredThpPending(row.pendingJson);
}

export async function saveHqThpPending(
  allianceId: string,
  hqUserId: string,
  pending: ThpPendingState | null,
): Promise<void> {
  const db = getDb();
  if (!pending) {
    await db
      .delete(schema.hqThpPending)
      .where(
        and(
          eq(schema.hqThpPending.allianceId, allianceId),
          eq(schema.hqThpPending.hqUserId, hqUserId),
        ),
      );
    return;
  }
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await db
    .insert(schema.hqThpPending)
    .values({
      allianceId,
      hqUserId,
      pendingJson: pending as unknown as Record<string, unknown>,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.hqThpPending.allianceId, schema.hqThpPending.hqUserId],
      set: {
        pendingJson: pending as unknown as Record<string, unknown>,
        expiresAt,
        updatedAt: new Date(),
      },
    });
}

export async function getCommanderMembershipInAlliance(
  commanderId: string,
  allianceId: string,
) {
  const db = getDb();
  const [row] = await db
    .select({
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
      memberName: schema.allianceMembers.currentName,
    })
    .from(schema.commanderAllianceMemberships)
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
        eq(schema.commanderAllianceMemberships.commanderId, commanderId),
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function countAllianceThpReporters(allianceId: string): Promise<number> {
  const rows = await listAllianceCommanderThpRows(allianceId);
  return rows.filter((row) => row.total != null && row.total > 0).length;
}
