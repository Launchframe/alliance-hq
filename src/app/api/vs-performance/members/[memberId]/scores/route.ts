import { after, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { requireApiSession } from "@/lib/session";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";
import { VsEvidenceError } from "@/lib/vs-scores/evidence.shared";
import { syncVsScoresForAlliance } from "@/lib/vs-scores/sync.server";
import { vsActorForSession } from "@/lib/vs-performance/api-helpers.server";
import { saveManualVsScores } from "@/lib/vs-performance/member-score-edit.server";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ memberId: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;
  const { memberId } = await context.params;
  const t = await getTranslations();
  try {
    const body = await request.json().catch(() => null);
    const result = await saveManualVsScores(actor.sessionId, actor.allianceId, memberId, body);
    if (!result.replayed) {
      after(async () => {
        try {
          await syncVsScoresForAlliance(actor.allianceId);
        } catch {
          // Sync failures must not turn a committed HQ save into an error response.
        }
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    const code =
      error instanceof VsComplianceError || error instanceof VsEvidenceError || error instanceof VsPerformanceError
        ? error.code
        : "save";
    const status =
      error instanceof VsComplianceError || error instanceof VsEvidenceError || error instanceof VsPerformanceError
        ? error.status
        : 500;
    if (code === "forbidden") return NextResponse.json({ code, error: t("vsPerformance.errors.forbidden") }, { status: 403 });
    if (code === "not_found") return NextResponse.json({ code, error: t("vsPerformance.member.notFound") }, { status: 404 });
    if (code === "invalid_period") return NextResponse.json({ code, error: t("vsPerformance.member.futureDay") }, { status: 400 });
    if (code === "invalid_score" || code === "invalid_rows" || code === "invalid_member" || code === "invalid_week") {
      return NextResponse.json({ code, error: t("vsPerformance.member.scoreInvalid") }, { status: 400 });
    }
    if (status === 409) return NextResponse.json({ code: "stale", error: t("vsPerformance.member.scoreChanged") }, { status: 409 });
    return NextResponse.json({ code: "save", error: t("vsPerformance.errors.save") }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
