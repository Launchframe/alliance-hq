import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { requireApiSession } from "@/lib/session";
import { requireAlliancePermission, requireTrainOfficer } from "@/lib/rbac/require-permission";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { CoverageConflictError, keepCoverageAssignment, listCoverageConflicts } from "@/lib/time-off/coverage.server";
import { routeCoverageConflicts } from "@/lib/time-off/coverage-routing.server";
import { isTimeOffDate } from "@/lib/time-off/workflow.shared";

export const dynamic = "force-dynamic";

async function context() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;
  const ctx = await resolveTrainRequestContext();
  return ctx instanceof NextResponse ? ctx : { allianceId: ctx.allianceId, hqUserId: session.hqUserId, sessionId: session.id };
}

export async function GET(request: Request) {
  const actor = await context();
  if (actor instanceof NextResponse) return actor;
  const params = new URL(request.url).searchParams;
  const start = params.get("start") ?? getServerCalendarDate();
  const end = params.get("end") ?? addCalendarDays(start, 90);
  if (!isTimeOffDate(start) || !isTimeOffDate(end) || end < start || end > addCalendarDays(start, 366)) {
    const t = await getTranslations("timeOff.workflow.errors");
    return NextResponse.json({ error: t("invalidDate") }, { status: 400 });
  }
  const canManageProfession = !(await requireAlliancePermission(actor.sessionId, actor.allianceId, "alliance:admin"));
  const conflicts = await routeCoverageConflicts(actor.allianceId, await listCoverageConflicts(actor.allianceId, start, end));
  return NextResponse.json({ conflicts: conflicts.map((conflict) => ({ ...conflict, canManage: conflict.dutyRole !== "engineer" || canManageProfession })) });
}

export async function POST(request: Request) {
  const actor = await context();
  if (actor instanceof NextResponse) return actor;
  const t = await getTranslations("timeOff.workflow.errors");
  const body = await request.json().catch(() => null);
  if (!body?.coverage || !Array.isArray(body.coverage.conflicts)) return NextResponse.json({ error: t("staleEntry") }, { status: 409 });
  if (body.coverage.conflicts.some((conflict: { dutyRole?: string } | null) => conflict?.dutyRole === "engineer")) {
    const denied = await requireAlliancePermission(actor.sessionId, actor.allianceId, "alliance:admin");
    if (denied) return denied;
  }
  try {
    await keepCoverageAssignment(actor, body.coverage);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (!(error instanceof CoverageConflictError)) throw error;
    return NextResponse.json({ code: "coverage_conflict", error: t("staleEntry"), conflicts: error.conflicts }, { status: 409 });
  }
}
