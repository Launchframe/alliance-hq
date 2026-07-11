import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { ParsedConnection } from "@/lib/connectionString";
import { assertAllianceAshedLinked } from "@/lib/alliance/ashed-write-guard";
import { base44EntityPost } from "@/lib/base44/fetch";
import { getDb, schema } from "@/lib/db";
import type { ScoreTargetDef, SeasonalBoardType } from "@/lib/video/score-targets";
import { getScoreTargetOrThrow } from "@/lib/video/score-targets";

type ProvisionOptions = {
  /** HQ tenant alliance id (hq_events / series rows). */
  allianceId: string;
  scoreTargetId: string;
  hqEventId: string;
  boardKey?: string;
  commendationId?: string;
  recordedDate: string;
};

type AshedIds = {
  ashedEventId: string;
  ashedSeriesId: string;
};

export async function resolveAshedEventId(
  connection: ParsedConnection,
  options: ProvisionOptions,
): Promise<AshedIds> {
  const target = getScoreTargetOrThrow(options.scoreTargetId);
  if (!target.seriesEntity) {
    throw new Error("Target does not use EventSeries provisioning.");
  }

  const { ashedAllianceId } = await assertAllianceAshedLinked(options.allianceId);

  const db = getDb();
  const [hqEvent] = await db
    .select()
    .from(schema.hqEvents)
    .where(
      and(
        eq(schema.hqEvents.id, options.hqEventId),
        eq(schema.hqEvents.allianceId, options.allianceId),
      ),
    )
    .limit(1);

  if (!hqEvent) {
    throw new Error("HQ event not found.");
  }

  const scoreType = resolveScoreType(target, options.boardKey);
  const series = await ensureEventSeries(
    connection,
    db,
    target,
    hqEvent,
    options.allianceId,
    ashedAllianceId,
    scoreType,
  );
  const board = await ensureEventBoard(
    connection,
    db,
    target,
    hqEvent,
    series.ashedSeriesId!,
    options,
    ashedAllianceId,
    scoreType,
  );

  return {
    ashedEventId: board.ashedEventId!,
    ashedSeriesId: series.ashedSeriesId!,
  };
}

function resolveScoreType(
  target: ScoreTargetDef,
  boardKey?: string,
): string {
  if (target.leaderboardModel === "multi-board" && boardKey) {
    return boardKey;
  }
  return target.defaultScoreType ?? "points";
}

async function ensureEventSeries(
  connection: ParsedConnection,
  db: ReturnType<typeof getDb>,
  target: ScoreTargetDef,
  hqEvent: typeof schema.hqEvents.$inferSelect,
  hqAllianceId: string,
  ashedAllianceId: string,
  scoreType: string,
) {
  if (hqEvent.seriesId) {
    const [existing] = await db
      .select()
      .from(schema.hqEventSeries)
      .where(eq(schema.hqEventSeries.id, hqEvent.seriesId))
      .limit(1);
    if (existing?.ashedSeriesId) {
      return existing;
    }
  }

  let [series] = hqEvent.seriesId
    ? await db
        .select()
        .from(schema.hqEventSeries)
        .where(eq(schema.hqEventSeries.id, hqEvent.seriesId))
        .limit(1)
    : [];

  if (!series) {
    const seriesId = nanoid(16);
    await db.insert(schema.hqEventSeries).values({
      id: seriesId,
      allianceId: hqAllianceId,
      scoreTarget: target.id,
      name: target.defaultSeriesName ?? target.id,
      description: "",
      scoreType,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    [series] = await db
      .select()
      .from(schema.hqEventSeries)
      .where(eq(schema.hqEventSeries.id, seriesId))
      .limit(1);

    await db
      .update(schema.hqEvents)
      .set({ seriesId: seriesId, updatedAt: new Date() })
      .where(eq(schema.hqEvents.id, hqEvent.id));
  }

  if (series!.ashedSeriesId) {
    return series!;
  }

  const created = (await base44EntityPost(connection, "EventSeries", {
    name: series!.name,
    description: series!.description ?? "",
    score_type: scoreType,
    alliance_id: ashedAllianceId,
  })) as { id: string };

  await db
    .update(schema.hqEventSeries)
    .set({ ashedSeriesId: created.id, scoreType, updatedAt: new Date() })
    .where(eq(schema.hqEventSeries.id, series!.id));

  return { ...series!, ashedSeriesId: created.id };
}

async function ensureEventBoard(
  connection: ParsedConnection,
  db: ReturnType<typeof getDb>,
  target: ScoreTargetDef,
  hqEvent: typeof schema.hqEvents.$inferSelect,
  ashedSeriesId: string,
  options: ProvisionOptions,
  ashedAllianceId: string,
  scoreType: string,
) {
  const boardKey =
    options.boardKey ??
    options.commendationId ??
    (target.leaderboardModel === "linear-full" ? "default" : "main");

  const [existingBoard] = await db
    .select()
    .from(schema.hqEventBoards)
    .where(
      and(
        eq(schema.hqEventBoards.hqEventId, hqEvent.id),
        eq(schema.hqEventBoards.boardKey, boardKey),
      ),
    )
    .limit(1);

  if (existingBoard?.ashedEventId) {
    return existingBoard;
  }

  const eventName = buildSeasonalEventName(hqEvent.name, boardKey, target);
  const created = (await base44EntityPost(connection, "SeasonalEvent", {
    name: eventName,
    description: "",
    start_date: hqEvent.startDate ?? options.recordedDate,
    end_date: hqEvent.endDate ?? options.recordedDate,
    status: hqEvent.status ?? "active",
    score_type: scoreType,
    minimum_participation: null,
    series_id: ashedSeriesId,
    alliance_id: ashedAllianceId,
  })) as { id: string };

  if (existingBoard) {
    await db
      .update(schema.hqEventBoards)
      .set({
        ashedEventId: created.id,
        scoreType,
        updatedAt: new Date(),
      })
      .where(eq(schema.hqEventBoards.id, existingBoard.id));
    return { ...existingBoard, ashedEventId: created.id };
  }

  const boardId = nanoid(16);
  await db.insert(schema.hqEventBoards).values({
    id: boardId,
    hqEventId: hqEvent.id,
    boardKey,
    name: eventName,
    scoreType,
    commendationId: options.commendationId ?? null,
    ashedEventId: created.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  if (!hqEvent.ashedEventId && target.leaderboardModel === "linear-full") {
    await db
      .update(schema.hqEvents)
      .set({ ashedEventId: created.id, updatedAt: new Date() })
      .where(eq(schema.hqEvents.id, hqEvent.id));
  }

  const [board] = await db
    .select()
    .from(schema.hqEventBoards)
    .where(eq(schema.hqEventBoards.id, boardId))
    .limit(1);

  return board!;
}

function buildSeasonalEventName(
  occurrenceName: string,
  boardKey: string,
  target: ScoreTargetDef,
): string {
  if (target.leaderboardModel === "linear-full") {
    return occurrenceName;
  }
  if (boardKey === "default" || boardKey === "main") {
    return occurrenceName;
  }
  return `${occurrenceName} — ${boardKey}`;
}

export async function upsertHqEventMemberMetadata(
  hqEventId: string,
  memberId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.hqEventMembers)
    .where(
      and(
        eq(schema.hqEventMembers.hqEventId, hqEventId),
        eq(schema.hqEventMembers.memberId, memberId),
      ),
    )
    .limit(1);

  const now = new Date();
  if (existing) {
    await db
      .update(schema.hqEventMembers)
      .set({ metadata, updatedAt: now })
      .where(eq(schema.hqEventMembers.id, existing.id));
    return;
  }

  await db.insert(schema.hqEventMembers).values({
    id: nanoid(16),
    hqEventId,
    memberId,
    metadata,
    createdAt: now,
    updatedAt: now,
  });
}

export type { SeasonalBoardType };
