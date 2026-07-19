import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import {
  attachBusterDaySnapshotJob,
  loadBusterDayWizardState,
  serializeBusterDayReport,
  type BusterDaySnapshotKind,
} from "@/lib/vs-performance/buster-day-reports.server";
import { busterDayWeekMondayForDate } from "@/lib/vs-performance/buster-day.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function requireBusterDayAllianceContext() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return { error: denied as NextResponse };

  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return {
      error: NextResponse.json(
        { error: "No alliance selected." },
        { status: 400 },
      ),
    };
  }

  return { session, allianceId };
}

export async function GET() {
  const auth = await requireBusterDayAllianceContext();
  if ("error" in auth && auth.error) return auth.error;

  const state = await loadBusterDayWizardState(auth.allianceId);
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:write");
  if (denied) return denied;

  const allianceId = resolveSessionAllianceId(session);
  if (!allianceId) {
    return NextResponse.json(
      { error: "No alliance selected." },
      { status: 400 },
    );
  }

  const body = (await request.json()) as {
    kind?: BusterDaySnapshotKind;
    vsWeekMonday?: string;
    rosterJobId?: string | null;
    killsJobId?: string | null;
  };

  if (body.kind !== "pre" && body.kind !== "post") {
    return NextResponse.json(
      { error: "kind must be pre or post." },
      { status: 400 },
    );
  }

  const vsWeekMonday =
    body.vsWeekMonday?.trim() ||
    busterDayWeekMondayForDate(getServerCalendarDate());
  if (!DATE_PATTERN.test(vsWeekMonday)) {
    return NextResponse.json(
      { error: "vsWeekMonday must be YYYY-MM-DD." },
      { status: 400 },
    );
  }

  if (body.rosterJobId === undefined && body.killsJobId === undefined) {
    return NextResponse.json(
      { error: "Provide rosterJobId and/or killsJobId." },
      { status: 400 },
    );
  }

  const report = await attachBusterDaySnapshotJob({
    allianceId,
    vsWeekMonday,
    kind: body.kind,
    rosterJobId: body.rosterJobId,
    killsJobId: body.killsJobId,
  });

  return NextResponse.json({ report: serializeBusterDayReport(report) });
}
