import { NextResponse } from "next/server";

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
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
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

    const record = await getConductorRecord(ctx.allianceId, date);
    const stats =
      result.memberId && role === "conductor"
        ? await getConductorStats(ctx.allianceId, result.memberId)
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
