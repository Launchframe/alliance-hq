import "server-only";

import type { ParsedConnection } from "@/lib/connectionString";
import { base44CallFunction } from "@/lib/base44/fetch";

import type { DataBatchRow } from "./batch-authorization.shared";
import {
  buildBulkDeletePayload,
  buildBulkMovePayload,
} from "./bulk-function-payload.shared";

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
