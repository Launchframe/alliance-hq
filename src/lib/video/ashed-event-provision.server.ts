import "server-only";

import type { ParsedConnection } from "@/lib/connectionString";
import {
  base44CallFunction,
  base44EntityDelete,
  base44EntityPost,
  base44Json,
} from "@/lib/base44/fetch";
import {
  fetchAshedScoreRowsRaw,
  type RawAshedScoreRow,
} from "@/lib/data-management/ashed-date-scores.server";
import {
  buildAshedDateBulkDeletePayload,
} from "@/lib/data-management/bulk-function-payload.shared";
import type { DataBatchContext } from "@/lib/data-management/batch-authorization.shared";
import type { ScoreTargetDef } from "@/lib/video/score-targets";
import {
  buildAshedEventLookupQuery,
  buildAshedEventProvisionBody,
  pickAshedEventMatchingDate,
} from "@/lib/video/ashed-event-provision";

export type ResolveOrCreateAshedEventResult = {
  eventId: string;
  created: boolean;
};

/**
 * Reuse an existing Ashed event for alliance + date, or create one.
 * Team is not part of the event key (DS/CS team lives on score rows).
 */
export async function resolveOrCreateAshedEvent(params: {
  connection: ParsedConnection;
  eventEntity: string;
  ashedAllianceId: string;
  recordedDate: string;
}): Promise<ResolveOrCreateAshedEventResult> {
  const { connection, eventEntity, ashedAllianceId, recordedDate } = params;

  const q = encodeURIComponent(
    JSON.stringify(
      buildAshedEventLookupQuery(eventEntity, ashedAllianceId, recordedDate),
    ),
  );
  const rows = await base44Json<
    Array<{
      id?: string;
      event_date?: string | null;
      start_date?: string | null;
      end_date?: string | null;
      recorded_date?: string | null;
      date?: string | null;
    }>
  >(connection, `/entities/${eventEntity}?q=${q}`);

  const list = Array.isArray(rows) ? rows : [];
  let matched = pickAshedEventMatchingDate(list, recordedDate);

  // Broader alliance list when the date filter missed (loose Ashed filters).
  if (!matched?.id) {
    const allQ = encodeURIComponent(
      JSON.stringify({ alliance_id: ashedAllianceId }),
    );
    const allRows = await base44Json<
      Array<{
        id?: string;
        event_date?: string | null;
        start_date?: string | null;
        end_date?: string | null;
        recorded_date?: string | null;
        date?: string | null;
      }>
    >(connection, `/entities/${eventEntity}?q=${allQ}`);
    const allList = Array.isArray(allRows) ? allRows : [];
    matched = pickAshedEventMatchingDate(allList, recordedDate);
  }

  if (matched?.id) {
    return { eventId: matched.id, created: false };
  }

  const created = (await base44EntityPost(
    connection,
    eventEntity,
    buildAshedEventProvisionBody(eventEntity, ashedAllianceId, recordedDate),
  )) as { id?: string };
  if (!created?.id) {
    throw new Error(`Failed to create ${eventEntity}.`);
  }
  return { eventId: created.id, created: true };
}

type AshedScoreRowForDelete = RawAshedScoreRow;

function scoreRowMatchesReplaceContext(
  row: AshedScoreRowForDelete,
  recordedDate: string,
  context: DataBatchContext,
): boolean {
  const rowDate = row.recorded_date?.slice(0, 10);
  if (rowDate !== recordedDate) {
    return false;
  }
  if (context.eventId && row.event_id !== context.eventId) {
    return false;
  }
  if (context.team && row.team !== context.team) {
    return false;
  }
  if (context.boardKey && row.board_key !== context.boardKey) {
    return false;
  }
  if (context.hqEventId && row.hq_event_id !== context.hqEventId) {
    return false;
  }
  if (context.commendationId && row.commendation_id !== context.commendationId) {
    return false;
  }
  return true;
}

function usesRowScopedAshedScoreDelete(context: DataBatchContext): boolean {
  return Boolean(
    context.eventId ||
      context.team ||
      context.boardKey ||
      context.hqEventId ||
      context.commendationId,
  );
}

/**
 * Delete existing Ashed score rows that match the submit context.
 * Skips upstream calls when nothing matches (first upload — mirrors native Ashed).
 */
export async function deleteAshedScoreRowsForContext(params: {
  connection: ParsedConnection;
  submitEntity: string;
  ashedAllianceId: string;
  recordedDate: string;
  context: DataBatchContext;
}): Promise<number> {
  const list = await fetchAshedScoreRowsRaw({
    connection: params.connection,
    submitEntity: params.submitEntity,
    ashedAllianceId: params.ashedAllianceId,
    eventId: params.context.eventId,
  });
  const matching = list.filter((row) =>
    scoreRowMatchesReplaceContext(row, params.recordedDate, params.context),
  );

  let deleted = 0;
  for (const row of matching) {
    if (!row.id) continue;
    await base44EntityDelete(params.connection, params.submitEntity, row.id);
    deleted += 1;
  }
  return deleted;
}

/** Clear prior Ashed score rows for this submit context before re-insert. */
export async function replaceAshedScoresForContext(params: {
  connection: ParsedConnection;
  target: ScoreTargetDef;
  ashedAllianceId: string;
  recordedDate: string;
  context: DataBatchContext;
}): Promise<void> {
  if (usesRowScopedAshedScoreDelete(params.context)) {
    await deleteAshedScoreRowsForContext({
      connection: params.connection,
      submitEntity: params.target.submitEntity,
      ashedAllianceId: params.ashedAllianceId,
      recordedDate: params.recordedDate,
      context: params.context,
    });
    return;
  }

  await base44CallFunction(
    params.connection,
    "bulkDeleteByDate",
    buildAshedDateBulkDeletePayload({
      submitEntity: params.target.submitEntity,
      recordedDate: params.recordedDate,
      allianceId: params.ashedAllianceId,
    }),
  );
}
