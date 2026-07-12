import "server-only";

import type { ParsedConnection } from "@/lib/connectionString";
import {
  base44CallFunction,
  base44EntityPost,
  base44Json,
} from "@/lib/base44/fetch";
import { buildBulkDeletePayload } from "@/lib/data-management/bulk-function-payload.shared";
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

/** Clear prior Ashed score rows for this submit context before re-insert. */
export async function replaceAshedScoresForContext(params: {
  connection: ParsedConnection;
  target: ScoreTargetDef;
  ashedAllianceId: string;
  recordedDate: string;
  context: DataBatchContext;
}): Promise<void> {
  await base44CallFunction(
    params.connection,
    "bulkDeleteByDate",
    buildBulkDeletePayload({
      submitEntity: params.target.submitEntity,
      recordedDate: params.recordedDate,
      allianceId: params.ashedAllianceId,
      contextJson: params.context,
    }),
  );
}
