import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { normalizeMemberHqLevel } from "@/lib/members/member-level.shared";
import { getCommanderIdForMember } from "@/lib/thp/repository";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export type MemberStatSource =
  | "ashed_sync"
  | "video_parse"
  | "roster_import"
  | "manual";

export async function appendMemberGameLevelEventIfChanged(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  value: number;
  recordedDate?: string;
  source: MemberStatSource;
  recordedByHqUserId?: string | null;
}): Promise<boolean> {
  const recordedDate = input.recordedDate ?? getServerCalendarDate();
  const db = getDb();

  const [existing] = await db
    .select({ value: schema.memberGameLevelEvents.value })
    .from(schema.memberGameLevelEvents)
    .where(
      and(
        eq(schema.memberGameLevelEvents.allianceId, input.allianceId),
        eq(schema.memberGameLevelEvents.ashedMemberId, input.ashedMemberId),
        eq(schema.memberGameLevelEvents.recordedDate, recordedDate),
      ),
    )
    .limit(1);

  if (existing?.value === input.value) {
    return false;
  }

  await db.insert(schema.memberGameLevelEvents).values({
    id: nanoid(),
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    value: input.value,
    recordedDate,
    source: input.source,
    recordedByHqUserId: input.recordedByHqUserId ?? null,
  });
  return true;
}

export async function appendMemberPowerLevelEventIfChanged(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  value: string;
  recordedDate?: string;
  source: MemberStatSource;
  recordedByHqUserId?: string | null;
}): Promise<boolean> {
  const recordedDate = input.recordedDate ?? getServerCalendarDate();
  const db = getDb();

  const [existing] = await db
    .select({ value: schema.memberPowerLevelEvents.value })
    .from(schema.memberPowerLevelEvents)
    .where(
      and(
        eq(schema.memberPowerLevelEvents.allianceId, input.allianceId),
        eq(schema.memberPowerLevelEvents.ashedMemberId, input.ashedMemberId),
        eq(schema.memberPowerLevelEvents.recordedDate, recordedDate),
      ),
    )
    .limit(1);

  if (existing?.value === input.value) {
    return false;
  }

  await db.insert(schema.memberPowerLevelEvents).values({
    id: nanoid(),
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    value: input.value,
    recordedDate,
    source: input.source,
    recordedByHqUserId: input.recordedByHqUserId ?? null,
  });
  return true;
}

export async function appendCommanderPowerLevelEventIfChanged(input: {
  commanderId: string;
  allianceId: string;
  value: string;
  recordedDate?: string;
  source: MemberStatSource;
  recordedByHqUserId?: string | null;
}): Promise<boolean> {
  const recordedDate = input.recordedDate ?? getServerCalendarDate();
  const db = getDb();

  const [existing] = await db
    .select({ value: schema.commanderPowerLevelEvents.value })
    .from(schema.commanderPowerLevelEvents)
    .where(
      and(
        eq(schema.commanderPowerLevelEvents.commanderId, input.commanderId),
        eq(schema.commanderPowerLevelEvents.allianceId, input.allianceId),
        eq(schema.commanderPowerLevelEvents.recordedDate, recordedDate),
      ),
    )
    .limit(1);

  if (existing?.value === input.value) {
    return false;
  }

  await db.insert(schema.commanderPowerLevelEvents).values({
    id: nanoid(),
    commanderId: input.commanderId,
    allianceId: input.allianceId,
    value: input.value,
    recordedDate,
    source: input.source,
    recordedByHqUserId: input.recordedByHqUserId ?? null,
  });
  return true;
}

export async function seedMemberStatHistoriesFromAshed(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  levelHistory?: Array<{ value: number; recorded_date: string }>;
  professionalLevelHistory?: Array<{ value: number; recorded_date: string }>;
  killsHistory?: Array<{ value: number; recorded_date: string }>;
}): Promise<void> {
  for (const point of input.levelHistory ?? []) {
    const level = normalizeMemberHqLevel(point.value);
    if (level == null) continue;
    await appendMemberGameLevelEventIfChanged({
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      value: level,
      recordedDate: point.recorded_date,
      source: "ashed_sync",
    });
  }

  const db = getDb();

  for (const point of input.professionalLevelHistory ?? []) {
    const [existing] = await db
      .select({ id: schema.memberProfessionLevelEvents.id })
      .from(schema.memberProfessionLevelEvents)
      .where(
        and(
          eq(schema.memberProfessionLevelEvents.allianceId, input.allianceId),
          eq(
            schema.memberProfessionLevelEvents.ashedMemberId,
            input.ashedMemberId,
          ),
          eq(
            schema.memberProfessionLevelEvents.recordedDate,
            point.recorded_date,
          ),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(schema.memberProfessionLevelEvents).values({
        id: nanoid(),
        allianceId: input.allianceId,
        ashedMemberId: input.ashedMemberId,
        memberName: input.memberName,
        value: point.value,
        recordedDate: point.recorded_date,
        source: "ashed_sync",
      });
    }
  }

  for (const point of input.killsHistory ?? []) {
    const [existing] = await db
      .select({ id: schema.memberKillsEvents.id })
      .from(schema.memberKillsEvents)
      .where(
        and(
          eq(schema.memberKillsEvents.allianceId, input.allianceId),
          eq(schema.memberKillsEvents.ashedMemberId, input.ashedMemberId),
          eq(schema.memberKillsEvents.recordedDate, point.recorded_date),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(schema.memberKillsEvents).values({
        id: nanoid(),
        allianceId: input.allianceId,
        ashedMemberId: input.ashedMemberId,
        memberName: input.memberName,
        value: point.value,
        recordedDate: point.recorded_date,
        source: "ashed_sync",
      });
    }
  }
}
