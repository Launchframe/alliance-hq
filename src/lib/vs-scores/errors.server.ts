import "server-only";

import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { VsEvidenceError } from "./evidence.shared";

export async function vsEvidenceErrorResponse(error: unknown, period?: string) {
  const code = error instanceof VsEvidenceError ? error.code : "failed";
  const memberNames =
    error instanceof VsEvidenceError
      ? error.memberNames.map((name) => name.trim()).filter(Boolean)
      : [];
  const t = await getTranslations();
  const message =
    code === "stale"
      ? t("timeOff.workflow.errors.staleEntry")
      : code === "forbidden"
        ? t("timeOff.workflow.errors.forbidden")
        : code === "invalid_period"
          ? t(
              period === "weekly"
                ? "videoReview.vsWeeklyDateInvalid"
                : "videoReview.vsSundayInvalid",
            )
          : code === "invalid_member"
            ? memberNames.length > 0
              ? t("videoReview.invalidMemberBody", {
                  names: memberNames.join(", "),
                })
              : t("videoReview.invalidMemberBodyUnnamed")
            : t("common.uploadFailed");
  return NextResponse.json(
    {
      error: message,
      code,
      ...(code === "invalid_member" ? { memberNames } : {}),
    },
    { status: error instanceof VsEvidenceError ? error.status : 500 },
  );
}
