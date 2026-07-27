import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  importConductorHistory,
  listConductorSnapshotsForDateRange,
} from "@/lib/trains/service";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

/** Lookup existing conductor drafts/locks for a date range (review conflicts). */
export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(request.url);
  const rangeStart = url.searchParams.get("start")?.trim() ?? "";
  const rangeEnd = url.searchParams.get("end")?.trim() ?? "";
  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
    return NextResponse.json(
      { error: "start and end query params are required (YYYY-MM-DD)." },
      { status: 400 },
    );
  }

  const records = await listConductorSnapshotsForDateRange({
    allianceId: ctx.allianceId,
    rangeStart,
    rangeEnd,
  });
  return NextResponse.json({ records });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    rows?: Array<{ date?: string; memberId?: string; memberName?: string }>;
  };

  const rows = Array.isArray(body.rows)
    ? body.rows
        .map((row) => ({
          date: typeof row.date === "string" ? row.date.trim() : "",
          memberId: typeof row.memberId === "string" ? row.memberId.trim() : "",
          memberName:
            typeof row.memberName === "string" ? row.memberName.trim() : "",
        }))
        .filter((row) => row.date && row.memberId && row.memberName)
    : [];

  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows to import." }, { status: 400 });
  }

  const result = await importConductorHistory({
    allianceId: ctx.allianceId,
    rows,
  });

  return NextResponse.json(result);
}
