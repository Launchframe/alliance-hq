import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import { requireAlliancePermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import { vsActorForSession } from "@/lib/vs-performance/api-helpers.server";
import { validateVsPeriod, type VsPeriod } from "@/lib/vs-scores/evidence.shared";
import {
  importVsSpreadsheetScores,
  VsSpreadsheetFileError,
} from "@/lib/vs-scores/spreadsheet-import.server";
import { VS_SPREADSHEET_MAX_BYTES } from "@/lib/vs-scores/spreadsheet-file.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorKeyForCode(
  code: VsSpreadsheetFileError["code"],
):
  | "unsupportedType"
  | "tooLarge"
  | "noRows"
  | "tooManyRows"
  | "parseFailed" {
  switch (code) {
    case "unsupported_type":
      return "unsupportedType";
    case "too_large":
      return "tooLarge";
    case "no_rows":
      return "noRows";
    case "too_many_rows":
      return "tooManyRows";
    case "parse_failed":
      return "parseFailed";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const actor = vsActorForSession(session);
  if (actor instanceof NextResponse) return actor;
  if (!actor.hqUserId) {
    return NextResponse.json(
      { error: "Forbidden", code: "forbidden" },
      { status: 403 },
    );
  }
  const hqUserId = actor.hqUserId;

  const denied = await requireAlliancePermission(
    actor.sessionId,
    actor.allianceId,
    "scores:write",
  );
  if (denied) return denied;

  const t = await getTranslations("vsPerformance.import");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: t("errors.parseFailed"), code: "parse_failed" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: t("errors.unsupportedType"), code: "unsupported_type" },
      { status: 400 },
    );
  }
  if (file.size <= 0 || file.size > VS_SPREADSHEET_MAX_BYTES) {
    return NextResponse.json(
      { error: t("errors.tooLarge"), code: "too_large" },
      { status: 400 },
    );
  }

  const recordedDateRaw = form.get("recordedDate");
  const periodRaw = form.get("period");
  const recordedDate =
    typeof recordedDateRaw === "string" && recordedDateRaw.trim()
      ? recordedDateRaw.trim().slice(0, 10)
      : null;
  const period: VsPeriod | null =
    periodRaw === "weekly" || periodRaw === "daily" ? periodRaw : null;
  if (recordedDate && period && !validateVsPeriod(recordedDate, period)) {
    return NextResponse.json(
      {
        error:
          period === "weekly"
            ? t("errors.weeklyDateInvalid")
            : t("errors.dailyDateInvalid"),
        code: "invalid_period",
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await importVsSpreadsheetScores({
      sessionId: actor.sessionId,
      hqUserId,
      allianceId: actor.allianceId,
      buffer,
      fileName: file.name || "upload.xlsx",
      mimeType: file.type || null,
      recordedDate,
      period,
    });
    return NextResponse.json({
      ok: true,
      jobId: result.jobId,
      groupId: result.groupId,
      parseSessionId: result.parseSessionId,
      recordedDate: result.recordedDate,
      period: result.period,
      rowCount: result.rowCount,
      matchedCount: result.matchedCount,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof VsSpreadsheetFileError) {
      const key = errorKeyForCode(error.code);
      return NextResponse.json(
        {
          error: t(`errors.${key}`),
          code: error.code,
        },
        { status: 400 },
      );
    }
    console.error("[vs-spreadsheet-import]", error);
    return NextResponse.json(
      { error: t("errors.parseFailed"), code: "parse_failed" },
      { status: 500 },
    );
  }
}
