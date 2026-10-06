import { NextResponse } from "next/server";
import { changeLocalVsData, isLocalVsBatch } from "@/lib/vs-scores/data-management.server";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { loadAshedConnectionForAllianceCapability } from "@/lib/ashed/load-ashed-connection.server";
import { writeAuditLog } from "@/lib/bff/audit";
import { forwardBulkDeleteBatch } from "@/lib/data-management/batch-actions.server";
import { canManageDataBatch } from "@/lib/data-management/batch-authorization.shared";
import { resolveDataManagementApiContext } from "@/lib/data-management/api-context.server";
import {
  getAllianceDataBatch,
  markDataBatchDeleted,
} from "@/lib/data-management/batch-ledger.server";
import { retractEventEvidenceBatch } from "@/lib/hq-events/evidence-repository.server";
import { syncEventResults } from "@/lib/hq-events/ashed-sync.server";

type Props = {
  params: Promise<{ batchId: string }>;
};

export async function POST(_request: Request, { params }: Props) {
  const ctx = await resolveDataManagementApiContext();
  if (ctx instanceof NextResponse) return ctx;

  const { batchId } = await params;
  const batch = await getAllianceDataBatch({
    allianceId: ctx.allianceId,
    batchId,
  });
  if (!batch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (batch.status !== "active") {
    return NextResponse.json({ error: "Batch is not active." }, { status: 409 });
  }
  if (!canManageDataBatch(ctx.rbac, batch)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (isLocalVsBatch(batch)) return changeLocalVsData({ allianceId: ctx.allianceId, rbac: ctx.rbac, batches: [batch] });

  // Event-ledger batches may live on native (unlinked) alliances: no remote
  // rows exist to delete, so the local retraction path must not require an
  // Ashed connection.
  const eventEvidenceEventId =
    typeof batch.contextJson.hqEventId === "string" &&
    batch.contextJson.hqEventId.length > 0
      ? batch.contextJson.hqEventId
      : null;

  const connection = await loadAshedConnectionForAllianceCapability({
    sessionId: ctx.sessionId,
    allianceId: ctx.allianceId,
    capability: "data_management:write",
    delegatedAction: "data_management.batch_delete",
  });
  const ashedAllianceId = await getAshedAllianceIdIfLinked(ctx.allianceId);

  if (!eventEvidenceEventId || ashedAllianceId) {
    if (!connection) {
      return NextResponse.json(
        { error: "Ashed not connected" },
        { status: 503 },
      );
    }
    if (!ashedAllianceId) {
      return NextResponse.json(
        { error: "Alliance is not linked to Ashed." },
        { status: 409 },
      );
    }

    try {
      await forwardBulkDeleteBatch(connection, batch, ashedAllianceId);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message.slice(0, 240)
              : "Failed to delete batch upstream.",
        },
        { status: 502 },
      );
    }
  }

  await markDataBatchDeleted(batchId, ctx.allianceId);

  if (eventEvidenceEventId) {
    // Retract the evidence batch's observations, recompute board results, and
    // bump evidence_version so eligibility never points at deleted evidence.
    const retracted = await retractEventEvidenceBatch(
      {
        allianceId: ctx.allianceId,
        hqUserId: ctx.auditHqUserId,
        sessionId: ctx.sessionId,
      },
      {
        eventId: eventEvidenceEventId,
        sourceRef: batch.sourceJobId ?? undefined,
      },
    ).catch(() => null);
    if (retracted?.boardIds.length) {
      // Re-derive remote state (create-only): removed members' remote rows
      // reconcile on the next sync pass.
      await syncEventResults(
        {
          allianceId: ctx.allianceId,
          hqUserId: ctx.auditHqUserId,
          sessionId: ctx.sessionId,
        },
        { eventId: eventEvidenceEventId, boardIds: retracted.boardIds },
      ).catch(() => null);
    }
  }

  await writeAuditLog({
    sessionId: ctx.sessionId,
    allianceId: ctx.allianceId,
    hqUserId: ctx.auditHqUserId,
    action: "data.batch.delete",
    resourceType: "data_upload_batch",
    resourceName: batch.submitEntity,
    resourceId: batchId,
    metadata: {
      recordedDate: batch.recordedDate,
      scoreTarget: batch.scoreTarget,
      rowCount: batch.rowCount,
    },
  });

  return NextResponse.json({ ok: true, batchId, status: "deleted" });
}
