import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { applyManualConductorDraft } from "@/lib/trains/manual-conductor-draft.server";
import {
  MANUAL_PICK_ELIGIBILITY_OVERRIDE_CODE,
  isManualPickEligibilityError,
} from "@/lib/trains/depleting-manual-pick.shared";
import { getServerCalendarDate } from "@/lib/trains/service";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

function manualPickErrorStatus(error: unknown, message: string): number {
  if (isManualPickEligibilityError(error)) return 409;
  if (message.includes("already locked")) return 409;
  if (message.includes("already selected from the current pool generation")) {
    return 409;
  }
  return 400;
}

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    date?: string;
    memberId?: string;
    memberName?: string;
    allowEligibilityOverride?: boolean;
    allowSameGenerationReuse?: boolean;
  };

  const memberId = body.memberId?.trim();
  const memberName = body.memberName?.trim();
  if (!memberId || !memberName) {
    return NextResponse.json(
      { error: "memberId and memberName are required." },
      { status: 400 },
    );
  }

  const date = body.date?.trim() || getServerCalendarDate();

  try {
    const record = await applyManualConductorDraft({
      allianceId: ctx.allianceId,
      date,
      memberId,
      memberName,
      allowEligibilityOverride: body.allowEligibilityOverride === true,
      allowSameGenerationReuse: body.allowSameGenerationReuse === true,
    });

    return NextResponse.json({
      record: {
        ...record,
        lockedAt: record.lockedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pick failed.";
    if (isManualPickEligibilityError(error)) {
      return NextResponse.json(
        {
          error: message,
          code: MANUAL_PICK_ELIGIBILITY_OVERRIDE_CODE,
          reason: error.reason,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: message },
      { status: manualPickErrorStatus(error, message) },
    );
  }
}
