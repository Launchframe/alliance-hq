import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import { mergeServerTranslationKeyResolution } from "@/lib/feedback/translation-key-resolve";
import { resolveTranslationKeys } from "@/lib/feedback/translation-key-resolve-server";
import { getOrCreateSession } from "@/lib/session";

type Body = {
  locale?: string;
  displayedText?: string;
  suggestedTranslation?: string;
  pagePath?: string;
  i18nKey?: string | null;
  candidateKeys?: string[];
};

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    if (!session.hqUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as Body;
    const locale = body.locale?.trim();
    const displayedText = body.displayedText?.trim();
    const suggestedTranslation = body.suggestedTranslation?.trim();

    if (!locale || !displayedText || !suggestedTranslation) {
      return NextResponse.json(
        { error: "locale, displayedText, and suggestedTranslation are required" },
        { status: 400 },
      );
    }

    const serverResolved = resolveTranslationKeys(locale, displayedText);
    const resolved = mergeServerTranslationKeyResolution(
      serverResolved,
      body.i18nKey,
    );

    const id = nanoid(16);
    const now = new Date();
    const db = getDb();

    await db.insert(schema.translationCorrectionReports).values({
      id,
      hqUserId: session.hqUserId,
      allianceId: session.currentAllianceId ?? session.allianceId,
      locale,
      i18nKey: resolved.i18nKey,
      candidateKeys: resolved.candidateKeys,
      displayedText,
      suggestedTranslation,
      pagePath: body.pagePath ?? null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog({
      sessionId: session.id,
      allianceId: session.currentAllianceId ?? session.allianceId,
      hqUserId: session.hqUserId,
      action: "feedback.translation",
      resourceType: "translation_correction_report",
      resourceName: resolved.i18nKey ?? "translation_report",
      resourceId: id,
      metadata: { locale },
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch {
    return feedbackErrorResponse("Translation report failed");
  }
}
