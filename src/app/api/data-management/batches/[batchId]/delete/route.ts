import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import { forwardBulkDeleteBatch } from "@/lib/data-management/batch-actions.server";
import { canManageDataBatch } from "@/lib/data-management/batch-authorization.shared";
import { resolveDataManagementApiContext } from "@/lib/data-management/api-context.server";
import {
  getAllianceDataBatch,
  markDataBatchDeleted,
} from "@/lib/data-management/batch-ledger.server";
import { getAshedConnection } from "@/lib/session";

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

  const connection = await getAshedConnection(ctx.sessionId);
  if (!connection) {
    return NextResponse.json({ error: "Ashed not connected" }, { status: 503 });
  }

  try {
    await forwardBulkDeleteBatch(connection, batch, ctx.allianceId);
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

  await markDataBatchDeleted(batchId, ctx.allianceId);
  await writeAuditLog({
    sessionId: ctx.sessionId,
    allianceId: ctx.allianceId,
    hqUserId: ctx.rbac.hqUserId,
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
