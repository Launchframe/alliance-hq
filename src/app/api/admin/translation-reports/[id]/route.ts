import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { awardTranslationCommendations } from "@/lib/feedback/solicited-eligibility";
import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import {
  applyLocaleMessagePatch,
  I18nKeyNotFoundError,
  I18nKeyNotStringLeafError,
  LocalePatchNotAvailableError,
  UnsupportedLocaleError,
  type LocaleMessagePatchResult,
} from "@/lib/i18n/apply-locale-message";
import { readSessionId } from "@/lib/session";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";

type Props = {
  params: Promise<{ id: string }>;
};

type PatchBody = {
  status?: "pending" | "applied" | "dismissed";
  adminNotes?: string;
};

export async function PATCH(request: Request, { params }: Props) {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const forbidden = await requirePlatformMaintainer(sessionId);
    if (forbidden) return forbidden;

    const { id } = await params;
    const body = (await request.json()) as PatchBody;
    const status = body.status;
    if (!status || !["pending", "applied", "dismissed"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.translationCorrectionReports)
      .where(eq(schema.translationCorrectionReports.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let localePatch: LocaleMessagePatchResult | null = null;
    if (status === "applied") {
      if (!existing.i18nKey?.trim()) {
        return NextResponse.json(
          { error: "Report has no translation key" },
          { status: 400 },
        );
      }
      try {
        localePatch = await applyLocaleMessagePatch({
          locale: existing.locale,
          i18nKey: existing.i18nKey,
          suggestedTranslation: existing.suggestedTranslation,
        });
      } catch (err) {
        if (
          err instanceof UnsupportedLocaleError ||
          err instanceof I18nKeyNotFoundError ||
          err instanceof I18nKeyNotStringLeafError
        ) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        if (err instanceof LocalePatchNotAvailableError) {
          return NextResponse.json({ error: err.message }, { status: 503 });
        }
        throw err;
      }
    }

    const session = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1)
      .then((rows) => rows[0]);

    const now = new Date();
    await db
      .update(schema.translationCorrectionReports)
      .set({
        status,
        adminNotes: body.adminNotes ?? existing.adminNotes,
        reviewedBy: session?.hqUserId ?? null,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.translationCorrectionReports.id, id));

    let commendationResult: { appliedCount: number; awarded: string[] } | null =
      null;
    if (status === "applied") {
      commendationResult = await awardTranslationCommendations(
        existing.hqUserId,
      );
    }

    await writeAuditLog({
      sessionId,
      allianceId: existing.allianceId,
      hqUserId: session?.hqUserId ?? null,
      action: "feedback.translation.review",
      resourceType: "translation_correction_report",
      resourceName: status,
      resourceId: id,
      metadata: { reporterId: existing.hqUserId },
    });

    return NextResponse.json({
      ok: true,
      commendations: commendationResult,
      localePatch,
    });
  } catch {
    return feedbackErrorResponse("Update failed");
  }
}
