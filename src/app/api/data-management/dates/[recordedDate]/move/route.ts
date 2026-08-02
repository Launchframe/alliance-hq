import { NextResponse } from "next/server";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { writeAuditLog } from "@/lib/bff/audit";
import { forwardBulkMoveDate } from "@/lib/data-management/batch-actions.server";
import { canManageDataDate } from "@/lib/data-management/batch-authorization.shared";
import { resolveDataManagementApiContext } from "@/lib/data-management/api-context.server";
import {
  listAllianceDataBatches,
  markDataBatchesMovedForDate,
} from "@/lib/data-management/batch-ledger.server";
import {
  fetchAshedScoresForAlliance,
  filterAshedScoresByDate,
} from "@/lib/data-management/ashed-date-scores.server";
import { getScoreTarget } from "@/lib/video/score-targets";
import { getAshedConnection } from "@/lib/session";

type Props = {
  params: Promise<{ recordedDate: string }>;
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

  const { recordedDate } = await params;
  if (!isIsoDate(recordedDate)) {
    return NextResponse.json(
      { error: "recordedDate must be YYYY-MM-DD." },
      { status: 400 },
    );
  }
  if (recordedDate === newRecordedDate) {
    return NextResponse.json(
      { error: "Target date matches the current date." },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const scoreTarget = url.searchParams.get("scoreTarget")?.trim() ?? "";
  const target = getScoreTarget(scoreTarget);
  if (!target) {
    return NextResponse.json({ error: "Unknown score target." }, { status: 400 });
  }

  const ledgerBatches = await listAllianceDataBatches({
    allianceId: ctx.allianceId,
    scoreTarget: target.id,
    status: "active",
  });
  const batchesOnDate = ledgerBatches.filter(
    (batch) => batch.recordedDate === recordedDate,
  );

  const connection = await getAshedConnection(ctx.sessionId);
  const ashedAllianceId = await getAshedAllianceIdIfLinked(ctx.allianceId);

  let hasScoresWithoutLedger = false;
  if (connection && ashedAllianceId) {
    const rows = await fetchAshedScoresForAlliance(
      connection,
      target.submitEntity,
      ashedAllianceId,
    );
    hasScoresWithoutLedger =
      filterAshedScoresByDate(rows, recordedDate).length > 0 &&
      batchesOnDate.length === 0;
  }

  if (!canManageDataDate(ctx.rbac, batchesOnDate, hasScoresWithoutLedger)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!connection) {
    return NextResponse.json({ error: "Ashed not connected" }, { status: 503 });
  }
  if (!ashedAllianceId) {
    return NextResponse.json(
      { error: "Alliance is not linked to Ashed." },
      { status: 409 },
    );
  }

  try {
    await forwardBulkMoveDate(connection, {
      submitEntity: target.submitEntity,
      recordedDate,
      newRecordedDate,
      ashedAllianceId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 240)
            : "Failed to move scores upstream.",
      },
      { status: 502 },
    );
  }

  const ledgerMoved = await markDataBatchesMovedForDate({
    allianceId: ctx.allianceId,
    scoreTarget: target.id,
    recordedDate,
    newRecordedDate,
  });

  await writeAuditLog({
    sessionId: ctx.sessionId,
    allianceId: ctx.allianceId,
    hqUserId: ctx.auditHqUserId,
    action: "data.date.move",
    resourceType: "data_upload_batch",
    resourceName: target.submitEntity,
    resourceId: `${target.id}:${recordedDate}`,
    metadata: {
      fromDate: recordedDate,
      toDate: newRecordedDate,
      scoreTarget: target.id,
      ledgerBatchesMoved: ledgerMoved,
    },
  });

  return NextResponse.json({
    ok: true,
    recordedDate,
    scoreTarget: target.id,
    status: "moved",
    movedToDate: newRecordedDate,
  });
}
