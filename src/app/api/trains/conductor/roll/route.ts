import { NextResponse } from "next/server";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  getConductorStats,
  getConductorRecord,
} from "@/lib/trains/repository";
import {
  getServerCalendarDate,
  resolveTrainSeasonKey,
  rollForConductor,
  rollForVip,
  trainActionErrorResponse,
} from "@/lib/trains/service";
import { resolveRollDayConfig } from "@/lib/trains/day-config-resolve.server";
import { rollEventForTrain } from "@/lib/trains/event-draw.server";
import { resolveTrainActorHqUserId } from "@/lib/trains/train-ownership.server";
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
    requestId?: string;
    expectedEligibilityFingerprint?: string;
    acknowledgePollFallback?: boolean;
  };

  const date = body.date?.trim() || getServerCalendarDate();
  const role = body.role ?? "conductor";

  try {
    const seasonKey = await resolveTrainSeasonKey(ctx.allianceId);
    const dayConfig = await resolveRollDayConfig(
      ctx.allianceId,
      date,
      seasonKey,
    );
    const dayRule =
      role === "vip" ? dayConfig.vipRule : dayConfig.conductorRule;

    const previous = await getConductorRecord(ctx.allianceId, date);
    const result =
      dayRule?.kind === "event_scores"
        ? (
            await rollEventForTrain(
              {
                allianceId: ctx.allianceId,
                hqUserId: await resolveTrainActorHqUserId(session.id),
                sessionId: session.id,
              },
              {
                date,
                role,
                requestId: body.requestId ?? "",
                expectedEligibilityFingerprint:
                  body.expectedEligibilityFingerprint ?? "",
                acknowledgePollFallback: body.acknowledgePollFallback,
                seasonKey,
              },
            )
          ).result
        : role === "vip"
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
