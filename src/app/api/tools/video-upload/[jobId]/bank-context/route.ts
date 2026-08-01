import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { resolveDepositSlipUploadBankId } from "@/lib/banks/resolve-deposit-slip-upload-bank-id.server";
import { getDb, schema } from "@/lib/db";
import { BANK_WRITE_PERMISSION } from "@/lib/rbac/constants";
import { requireAlliancePermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";
import { resolveHqAllianceIdFromStoredAllianceId } from "@/lib/video/video-job-alliance.server";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";
import { isBankDepositSlipHistoryTarget } from "@/lib/video/score-targets";

type Props = { params: Promise<{ jobId: string }> };

type PatchBody = {
  bankId?: string | null;
};

/** Persist the officer's bank selection on a deposit-slip video job during review. */
export async function PATCH(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const access = await resolveVideoJobAccess(jobId, session.id, "read");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }

    const job = access.job;
    const scoreTargetId = job.scoreTarget ?? job.category ?? "";
    if (!isBankDepositSlipHistoryTarget(scoreTargetId)) {
      return NextResponse.json(
        { error: "This job does not use bank context." },
        { status: 400 },
      );
    }

    const allianceId = await resolveHqAllianceIdFromStoredAllianceId(
      job.allianceId,
    );
    if (!allianceId) {
      return NextResponse.json(
        { error: "Alliance context missing on job." },
        { status: 400 },
      );
    }

    const denied = await requireAlliancePermission(
      session.id,
      allianceId,
      BANK_WRITE_PERMISSION,
    );
    if (denied) return denied;

    const body = (await request.json()) as PatchBody;
    const resolvedBankId = await resolveDepositSlipUploadBankId(
      allianceId,
      scoreTargetId,
      body.bankId,
    );
    if (!resolvedBankId) {
      return NextResponse.json(
        { error: "bankId is invalid for this alliance." },
        { status: 400 },
      );
    }

    const db = getDb();
    await db
      .update(schema.videoJobs)
      .set({ bankId: resolvedBankId, updatedAt: new Date() })
      .where(eq(schema.videoJobs.id, jobId));

    return NextResponse.json({ ok: true, bankId: resolvedBankId });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update bank context",
      },
      { status: 500 },
    );
  }
}
