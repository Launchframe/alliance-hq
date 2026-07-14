import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { SubmitContext } from "@/lib/video/submit-schemas";
import type { ScoreTargetDef } from "@/lib/video/score-targets";

import {
  batchActionFlags,
  type DataBatchContext,
  type DataBatchRow,
} from "./batch-authorization.shared";
import type { RbacContext } from "@/lib/rbac/context";

function toBatchContext(context: SubmitContext): DataBatchContext {
  return {
    eventId: context.eventId,
    team: context.team,
    boardKey: context.boardKey,
    hqEventId: context.hqEventId,
    commendationId: context.commendationId,
  };
}

function mapBatchRow(row: typeof schema.dataUploadBatches.$inferSelect): DataBatchRow {
  return {
    id: row.id,
    allianceId: row.allianceId,
    scoreTarget: row.scoreTarget,
    submitEntity: row.submitEntity,
    recordedDate: row.recordedDate,
    contextJson: (row.contextJson ?? {}) as DataBatchContext,
    rowCount: row.rowCount,
    sourceJobId: row.sourceJobId,
    parseSessionId: row.parseSessionId,
    createdByHqUserId: row.createdByHqUserId,
    submittedAt: row.submittedAt.toISOString(),
    status: row.status,
    movedToDate: row.movedToDate,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export async function recordDataUploadBatch(input: {
  allianceId: string;
  target: ScoreTargetDef;
  submitContext: SubmitContext;
  rowCount: number;
  sourceJobId: string;
  parseSessionId: string | null;
  createdByHqUserId: string | null;
}): Promise<string> {
  const db = getDb();

  // One ledger row per video job — safe to call only after submit completes, and
  // also idempotent if a prior attempt wrote upstream before a local failure.
  const [existing] = await db
    .select({ id: schema.dataUploadBatches.id })
    .from(schema.dataUploadBatches)
    .where(eq(schema.dataUploadBatches.sourceJobId, input.sourceJobId))
    .limit(1);
  if (existing) {
    return existing.id;
  }

  const now = new Date();
  const id = nanoid(16);

  await db.insert(schema.dataUploadBatches).values({
    id,
    allianceId: input.allianceId,
    scoreTarget: input.target.id,
    submitEntity: input.target.submitEntity,
    recordedDate: input.submitContext.recordedDate,
    contextJson: toBatchContext(input.submitContext),
    rowCount: input.rowCount,
    sourceJobId: input.sourceJobId,
    parseSessionId: input.parseSessionId,
    createdByHqUserId: input.createdByHqUserId,
    submittedAt: now,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return id;
}

export async function listAllianceDataBatches(input: {
  allianceId: string;
  scoreTarget?: string;
  status?: string;
}): Promise<DataBatchRow[]> {
  const db = getDb();
  const filters = [eq(schema.dataUploadBatches.allianceId, input.allianceId)];
  if (input.scoreTarget) {
    filters.push(eq(schema.dataUploadBatches.scoreTarget, input.scoreTarget));
  }
  if (input.status) {
    filters.push(eq(schema.dataUploadBatches.status, input.status));
  }

  const rows = await db
    .select()
    .from(schema.dataUploadBatches)
    .where(and(...filters))
    .orderBy(
      desc(schema.dataUploadBatches.recordedDate),
      desc(schema.dataUploadBatches.submittedAt),
    );

  return rows.map(mapBatchRow);
}

export async function getAllianceDataBatch(input: {
  allianceId: string;
  batchId: string;
}): Promise<DataBatchRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dataUploadBatches)
    .where(
      and(
        eq(schema.dataUploadBatches.id, input.batchId),
        eq(schema.dataUploadBatches.allianceId, input.allianceId),
      ),
    )
    .limit(1);

  return row ? mapBatchRow(row) : null;
}

export function decorateBatchForViewer(
  batch: DataBatchRow,
  ctx: RbacContext,
): DataBatchRow & { canMove: boolean; canDelete: boolean } {
  const flags = batchActionFlags(ctx, batch);
  return { ...batch, ...flags };
}

export async function markDataBatchDeleted(
  batchId: string,
  allianceId: string,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.dataUploadBatches)
    .set({ status: "deleted", deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.dataUploadBatches.id, batchId),
        eq(schema.dataUploadBatches.allianceId, allianceId),
      ),
    );
}

/** Soft-delete active ledger rows that match a replace-submit context. */
export async function markMatchingDataBatchesDeleted(input: {
  allianceId: string;
  scoreTarget: string;
  recordedDate: string;
  /** Absent for date-keyed targets (VS, donations). */
  eventId?: string | null;
  team: string | null;
}): Promise<number> {
  const rows = await listAllianceDataBatches({
    allianceId: input.allianceId,
    scoreTarget: input.scoreTarget,
    status: "active",
  });
  const wantEventId = input.eventId ?? null;
  const matching = rows.filter((batch) => {
    if (batch.recordedDate !== input.recordedDate) return false;
    if ((batch.contextJson.eventId ?? null) !== wantEventId) return false;
    const batchTeam = batch.contextJson.team ?? null;
    if (input.team == null) {
      return batchTeam == null;
    }
    return batchTeam === input.team;
  });
  for (const batch of matching) {
    await markDataBatchDeleted(batch.id, input.allianceId);
  }
  return matching.length;
}

export async function markDataBatchMoved(
  batchId: string,
  allianceId: string,
  newRecordedDate: string,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .update(schema.dataUploadBatches)
    .set({
      status: "moved",
      movedToDate: newRecordedDate,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.dataUploadBatches.id, batchId),
        eq(schema.dataUploadBatches.allianceId, allianceId),
      ),
    );
}
