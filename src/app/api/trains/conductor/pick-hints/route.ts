import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { listMemberLastLockedConducts } from "@/lib/trains/repository";
import { getServerCalendarDate } from "@/lib/trains/service";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() || getServerCalendarDate();

  const rows = await listMemberLastLockedConducts(ctx.allianceId, date);
  const members = Object.fromEntries(
    rows.map((row) => [
      row.memberId,
      {
        lastConductedDate: row.date,
        conductorMechanism: row.conductorMechanism,
      },
    ]),
  );

  return NextResponse.json({ members, referenceDate: date });
}
