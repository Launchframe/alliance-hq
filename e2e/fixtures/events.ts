import { nanoid } from "nanoid";
import type { Sql } from "./db";

export type EventFamily =
  | "warzone-duel"
  | "frontline-breakthrough"
  | "seasonal"
  | "desert-storm"
  | "canyon-storm";

export async function createHqEvent(
  sql: Sql,
  input: {
    allianceId: string;
    eventFamily: EventFamily;
    name?: string;
    seriesId?: string;
    startDate?: string;
  },
) {
  const id = nanoid(16);
  const seriesId =
    input.seriesId ??
    (await (async () => {
      const sid = nanoid(16);
      await sql`
        INSERT INTO hq_event_series (id, alliance_id, score_target, name, event_family)
        VALUES (${sid}, ${input.allianceId}, ${input.eventFamily}, ${`${input.eventFamily} series`}, ${input.eventFamily})
      `;
      return sid;
    })());
  await sql`
    INSERT INTO hq_events (id, series_id, alliance_id, score_target, name, start_date, status, event_family, policy_version)
    VALUES (
      ${id},
      ${seriesId},
      ${input.allianceId},
      ${input.eventFamily},
      ${input.name ?? `Event ${nanoid(4)}`},
      ${input.startDate ?? null},
      'active',
      ${input.eventFamily},
      1
    )
  `;
  return { id, seriesId };
}

export async function createHqEventBoard(
  sql: Sql,
  input: {
    allianceId: string;
    hqEventId: string;
    boardKey?: string;
    name?: string;
    scoreType?: string;
  },
) {
  const id = nanoid(16);
  await sql`
    INSERT INTO hq_event_boards (id, alliance_id, hq_event_id, board_key, name, score_type)
    VALUES (
      ${id},
      ${input.allianceId},
      ${input.hqEventId},
      ${input.boardKey ?? "main"},
      ${input.name ?? "Main board"},
      ${input.scoreType ?? "points"}
    )
  `;
  return { id };
}

/**
 * Seed a committed evidence batch + observations + recomputed member results,
 * then mark the board ready at its current evidence_version so event_scores
 * rules can draw immediately.
 */
export async function seedReadyEventBoard(
  sql: Sql,
  input: {
    allianceId: string;
    hqEventId: string;
    boardId: string;
    actorHqUserId?: string;
    rows: Array<{
      memberId: string;
      memberName?: string;
      realScore?: number;
      evidenceKind?: "leaderboard" | "poll_yes" | "poll_no";
      observedRank?: number;
    }>;
  },
) {
  const batchId = nanoid(16);
  await sql`
    INSERT INTO hq_event_evidence_batches (id, alliance_id, hq_event_id, board_id, source_kind, status, import_status, created_by, reviewed_by)
    VALUES (${batchId}, ${input.allianceId}, ${input.hqEventId}, ${input.boardId}, 'manual', 'committed', 'complete', ${input.actorHqUserId ?? null}, ${input.actorHqUserId ?? null})
  `;
  for (const [index, row] of input.rows.entries()) {
    const observationId = nanoid(16);
    const evidenceKind = row.evidenceKind ?? "leaderboard";
    await sql`
      INSERT INTO hq_event_observations (id, alliance_id, hq_event_id, board_id, batch_id, source_row_key, member_id, member_name, evidence_kind, real_score, observed_rank, poll_option, provenance)
      VALUES (
        ${observationId},
        ${input.allianceId},
        ${input.hqEventId},
        ${input.boardId},
        ${batchId},
        ${`row-${index}`},
        ${row.memberId},
        ${row.memberName ?? null},
        ${evidenceKind},
        ${row.realScore != null ? String(row.realScore) : null},
        ${row.observedRank ?? null},
        ${evidenceKind === "poll_yes" ? 1 : evidenceKind === "poll_no" ? 2 : null},
        'manual'
      )
    `;
    const evidenceClass =
      evidenceKind === "leaderboard"
        ? "real"
        : evidenceKind === "poll_yes"
          ? "yes_only"
          : "explicit_no";
    await sql`
      INSERT INTO hq_event_member_results (id, alliance_id, hq_event_id, board_id, member_id, member_name, real_score, observed_rank, evidence_class)
      VALUES (
        ${nanoid(16)},
        ${input.allianceId},
        ${input.hqEventId},
        ${input.boardId},
        ${row.memberId},
        ${row.memberName ?? null},
        ${row.realScore != null ? String(row.realScore) : null},
        ${row.observedRank ?? null},
        ${evidenceClass}
      )
    `;
  }
  await sql`
    UPDATE hq_event_boards
    SET evidence_version = 1, ready_version = 1, ready_sources = ${sql.json([batchId])}
    WHERE id = ${input.boardId}
  `;
  return { batchId };
}

/** Paint a day rule directly (server-equivalent of the schedule PATCH). */
export async function paintDayRule(
  sql: Sql,
  input: {
    allianceId: string;
    date: string;
    conductorRule: Record<string, unknown> | null;
    vipRule?: Record<string, unknown> | null;
  },
) {
  await sql`
    INSERT INTO train_day_configs (id, alliance_id, date, conductor_rule, vip_rule, is_override)
    VALUES (
      ${nanoid(16)},
      ${input.allianceId},
      ${input.date},
      ${input.conductorRule ? sql.json(JSON.parse(JSON.stringify(input.conductorRule))) : null},
      ${input.vipRule === undefined ? null : input.vipRule ? sql.json(JSON.parse(JSON.stringify(input.vipRule))) : null},
      1
    )
    ON CONFLICT (alliance_id, date)
    DO UPDATE SET
      conductor_rule = EXCLUDED.conductor_rule,
      vip_rule = COALESCE(EXCLUDED.vip_rule, train_day_configs.vip_rule)
  `;
}
