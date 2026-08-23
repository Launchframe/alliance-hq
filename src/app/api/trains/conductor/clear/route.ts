import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/bff/audit";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  clearConductorAssignment,
  getConductorRecord,
} from "@/lib/trains/repository";
import { getServerCalendarDate } from "@/lib/trains/service";
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

  const body = (await request.json()) as { date?: string };
  const date = body.date?.trim() || getServerCalendarDate();

  try {
    const seasonKey = (await getEffectiveSeasonForAlliance(ctx.allianceId))
      .seasonKey;
    const record = await getConductorRecord(ctx.allianceId, date, seasonKey);

    if (!record) {
      return NextResponse.json(
        { error: "No conductor record for this day." },
        { status: 404 },
      );
    }
    if (record.lockedAt) {
      return NextResponse.json(
        { error: "Conductor is already locked for this day." },
        { status: 409 },
      );
    }
    if (!record.conductorMemberId) {
      return NextResponse.json(
        { error: "No pending conductor for this day." },
        { status: 400 },
      );
    }

    const cleared = await clearConductorAssignment(
      ctx.allianceId,
      date,
      seasonKey,
    );

    await writeAuditLog({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId ?? undefined,
      action: "trains.conductor_clear",
      resourceType: "train_conductor_record",
      resourceId: record.id,
      resourceName: record.conductorMemberName ?? undefined,
      metadata: {
        date,
        conductorMemberId: record.conductorMemberId,
      },
    });

    return NextResponse.json({
      record: cleared
        ? {
            ...cleared,
            lockedAt: cleared.lockedAt?.toISOString() ?? null,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clear failed.";
    const status = message.includes("already locked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
