import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import { forwardBulkMoveBatch } from "@/lib/data-management/batch-actions.server";
import { canManageDataBatch } from "@/lib/data-management/batch-authorization.shared";
import { resolveDataManagementApiContext } from "@/lib/data-management/api-context.server";
import {
  getAllianceDataBatch,
  markDataBatchMoved,
} from "@/lib/data-management/batch-ledger.server";
import { getAshedConnection } from "@/lib/session";

type Props = {
  params: Promise<{ batchId: string }>;
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: Request, { params }: Props) {
  const ctx = await resolveDataManagementApiContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as { newRecordedDate?: unknown };
  const newRecordedDate =
    typeof body.newRecordedDate === "string"
      ? body.newRecordedDate.trim()
      : "";
  if (!isIsoDate(newRecordedDate)) {
    return NextResponse.json(
      { error: "newRecordedDate must be YYYY-MM-DD." },
      { status: 400 },
    );
  }

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
  if (batch.recordedDate === newRecordedDate) {
    return NextResponse.json(
      { error: "Target date matches the current batch date." },
      { status: 400 },
    );
  }

  const connection = await getAshedConnection(ctx.sessionId);
  if (!connection) {
    return NextResponse.json({ error: "Ashed not connected" }, { status: 503 });
  }

  try {
    await forwardBulkMoveBatch(
      connection,
      batch,
      ctx.allianceId,
      newRecordedDate,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 240)
            : "Failed to move batch upstream.",
      },
      { status: 502 },
    );
  }

  await markDataBatchMoved(batchId, newRecordedDate);
  await writeAuditLog({
    sessionId: ctx.sessionId,
    allianceId: ctx.allianceId,
    hqUserId: ctx.rbac.hqUserId,
    action: "data.batch.move",
    resourceType: "data_upload_batch",
    resourceName: batch.submitEntity,
    resourceId: batchId,
    metadata: {
      fromDate: batch.recordedDate,
      toDate: newRecordedDate,
      scoreTarget: batch.scoreTarget,
      rowCount: batch.rowCount,
    },
  });

  return NextResponse.json({
    ok: true,
    batchId,
    status: "moved",
    movedToDate: newRecordedDate,
  });
}
