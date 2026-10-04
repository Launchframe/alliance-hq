import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { requireApiSession } from "@/lib/session";
import { requireAlliancePermission } from "@/lib/rbac/require-permission";
import { resolveProfessionRequestContext } from "@/lib/professions/api-context";
import { setEngCoverageWindow } from "@/lib/professions/service";
import { updateCoverageWindow } from "@/lib/professions/repository";
import { CoverageConflictError, withCoverageActor } from "@/lib/time-off/coverage.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const t = await getTranslations("timeOff.workflow.errors");
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) return NextResponse.json({ error: t("forbidden") }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: t("saveFailed") }, { status: 400 });
  if (body.assignmentId !== undefined || body.coverage !== undefined) {
    const denied = await requireAlliancePermission(session.id, allianceId, "alliance:admin");
    if (denied) return denied;
  }
  const startHour = body.coverageStartHour ?? null;
  const endHour = body.coverageEndHour ?? null;
  if ([startHour, endHour].some((hour) => hour !== null && (!Number.isInteger(hour) || hour < 0 || hour > 23)) || (startHour === null) !== (endHour === null) || (body.assignmentId !== undefined && (typeof body.assignmentId !== "string" || !body.assignmentId))) {
    return NextResponse.json({ error: t("saveFailed") }, { status: 400 });
  }
  const ctx = body.assignmentId === undefined ? await resolveProfessionRequestContext() : null;
  if (ctx instanceof NextResponse) return ctx;
  if (ctx && ctx.profession !== "Engineer") return NextResponse.json({ error: t("forbidden") }, { status: 403 });
  try {
    await withCoverageActor({ allianceId, hqUserId: session.hqUserId, acceptance: body.coverage }, () => body.assignmentId !== undefined
      ? updateCoverageWindow(body.assignmentId, startHour, endHour, allianceId)
      : setEngCoverageWindow(allianceId, ctx!.commanderId, startHour, endHour));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CoverageConflictError) return NextResponse.json({ code: "coverage_conflict", error: t("staleEntry"), conflicts: error.conflicts }, { status: 409 });
    return NextResponse.json({ error: t("saveFailed") }, { status: 400 });
  }
}
