import { NextResponse } from "next/server";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  getConductorStats,
  getConductorRecord,
} from "@/lib/trains/repository";
import {
  getServerCalendarDate,
  rollForConductor,
  rollForVip,
  trainActionErrorResponse,
} from "@/lib/trains/service";
import { trainRollErrorResponse } from "@/lib/trains/roll-errors.server";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

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
    role?: "conductor" | "vip";
  };

  const date = body.date?.trim() || getServerCalendarDate();
  const role = body.role ?? "conductor";

  try {
    const previous = await getConductorRecord(ctx.allianceId, date);
    const result =
      role === "vip"
        ? await rollForVip({
            allianceId: ctx.allianceId,
            date,
          })
        : await rollForConductor({
            allianceId: ctx.allianceId,
            date,
          });

    const previousMemberId =
      role === "vip" ? previous?.vipMemberId : previous?.conductorMemberId;
    const previousMemberName =
      role === "vip"
        ? previous?.vipMemberName
        : previous?.conductorMemberName;
    const overwritten = Boolean(
      previousMemberId && previousMemberId !== result.memberId,
    );
    await writeTrainsOfficerAudit({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId,
      action:
        role === "vip" ? "trains.vip_roll" : "trains.conductor_roll",
      severity: overwritten ? "update" : "routine",
      resourceType: "train_conductor_record",
      resourceId: `${ctx.allianceId}:${date}`,
      resourceName: result.memberName,
      metadata: {
        date,
        role,
        landedMemberId: result.memberId,
        landedMemberName: result.memberName,
        previousMemberId: previousMemberId ?? null,
        previousMemberName: previousMemberName ?? null,
        overwritten,
        spinAgain: Boolean(previousMemberId && !previous?.lockedAt),
        source: "wheel",
      },
    });

    const record = await getConductorRecord(ctx.allianceId, date);
    const stats =
      result.memberId && role === "conductor"
        ? await getConductorStats(ctx.allianceId, result.memberId, {
            beforeDate: date,
          })
        : null;

    return NextResponse.json({ result, record, stats });
  } catch (error) {
    const actionError = trainActionErrorResponse(error);
    if (actionError.status === 409) {
      return NextResponse.json(actionError.body, { status: actionError.status });
    }
    const { status, body } = trainRollErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
