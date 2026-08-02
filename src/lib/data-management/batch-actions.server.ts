import "server-only";

import type { ParsedConnection } from "@/lib/connectionString";
import { base44CallFunction } from "@/lib/base44/fetch";
import type { RbacContext } from "@/lib/rbac/context";

import type { DataBatchRow } from "./batch-authorization.shared";
import {
  dateActionFlags,
  type DataDateSummary,
} from "./batch-authorization.shared";
import {
  countTeamsOnDate,
  fetchAshedScoresForAlliance,
  groupAshedScoresByDate,
  type AshedDateScoreRow,
} from "./ashed-date-scores.server";
import {
  buildAshedDateBulkDeletePayload,
  buildAshedDateBulkMovePayload,
  buildBulkDeletePayload,
  buildBulkMovePayload,
} from "./bulk-function-payload.shared";

export async function buildDataDateSummaries(input: {
  connection: ParsedConnection | null;
  ashedAllianceId: string | null;
  submitEntity: string;
  ledgerBatches: DataBatchRow[];
  rbac: RbacContext;
}): Promise<DataDateSummary[]> {
  let ashedByDate = new Map<string, AshedDateScoreRow[]>();
  if (input.connection && input.ashedAllianceId) {
    const rows = await fetchAshedScoresForAlliance(
      input.connection,
      input.submitEntity,
      input.ashedAllianceId,
    );
    ashedByDate = groupAshedScoresByDate(rows);
  }

  const ledgerByDate = new Map<string, DataBatchRow[]>();
  for (const batch of input.ledgerBatches) {
    const bucket = ledgerByDate.get(batch.recordedDate);
    if (bucket) {
      bucket.push(batch);
    } else {
      ledgerByDate.set(batch.recordedDate, [batch]);
    }
  }

  const allDates = new Set([
    ...ashedByDate.keys(),
    ...ledgerByDate.keys(),
  ]);
  const summaries: DataDateSummary[] = [];

  for (const recordedDate of allDates) {
    const ashedRows = ashedByDate.get(recordedDate) ?? [];
    const batches = ledgerByDate.get(recordedDate) ?? [];
    const hasScoresWithoutLedger =
      ashedRows.length > 0 && batches.length === 0;
    const { teamACount, teamBCount } = countTeamsOnDate(ashedRows);
    const ledgerRowSum = batches.reduce((sum, batch) => sum + batch.rowCount, 0);
    const flags = dateActionFlags(
      input.rbac,
      batches,
      hasScoresWithoutLedger,
    );
    let latestSubmittedAt: string | null = null;
    for (const batch of batches) {
      if (
        !latestSubmittedAt ||
        batch.submittedAt.localeCompare(latestSubmittedAt) > 0
      ) {
        latestSubmittedAt = batch.submittedAt;
      }
    }
    summaries.push({
      recordedDate,
      rowCount: ashedRows.length > 0 ? ashedRows.length : ledgerRowSum,
      teamACount,
      teamBCount,
      latestSubmittedAt,
      ...flags,
    });
  }

  summaries.sort((a, b) => b.recordedDate.localeCompare(a.recordedDate));
  return summaries;
}

export async function forwardBulkDeleteDate(
  connection: ParsedConnection,
  input: {
    submitEntity: string;
    recordedDate: string;
    ashedAllianceId: string;
  },
): Promise<void> {
  await base44CallFunction(
    connection,
    "bulkDeleteByDate",
    buildAshedDateBulkDeletePayload({
      submitEntity: input.submitEntity,
      recordedDate: input.recordedDate,
      allianceId: input.ashedAllianceId,
    }),
  );
}

export async function forwardBulkMoveDate(
  connection: ParsedConnection,
  input: {
    submitEntity: string;
    recordedDate: string;
    newRecordedDate: string;
    ashedAllianceId: string;
  },
): Promise<void> {
  await base44CallFunction(
    connection,
    "bulkMoveByDate",
    buildAshedDateBulkMovePayload({
      submitEntity: input.submitEntity,
      recordedDate: input.recordedDate,
      newRecordedDate: input.newRecordedDate,
      allianceId: input.ashedAllianceId,
    }),
  );
}

export async function forwardBulkDeleteBatch(
  connection: ParsedConnection,
  batch: DataBatchRow,
  allianceId: string,
): Promise<void> {
  await base44CallFunction(
    connection,
    "bulkDeleteByDate",
    buildBulkDeletePayload({
      submitEntity: batch.submitEntity,
      recordedDate: batch.recordedDate,
      allianceId,
      contextJson: batch.contextJson,
    }),
  );
}

export async function forwardBulkMoveBatch(
  connection: ParsedConnection,
  batch: DataBatchRow,
  allianceId: string,
  newRecordedDate: string,
): Promise<void> {
  await base44CallFunction(
    connection,
    "bulkMoveByDate",
    buildBulkMovePayload({
      submitEntity: batch.submitEntity,
      recordedDate: batch.recordedDate,
      newRecordedDate,
      allianceId,
      contextJson: batch.contextJson,
    }),
  );
}
