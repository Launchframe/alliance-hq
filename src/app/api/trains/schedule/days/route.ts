import { NextResponse } from "next/server";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { applyTemplateToDates } from "@/lib/trains/service";
import type { WeekTemplateType } from "@/lib/trains/types";
import { WEEK_TEMPLATES } from "@/lib/trains/types";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    dates?: string[];
    templateType?: WeekTemplateType;
  };

  const dates = (body.dates ?? []).filter(
    (date): date is string =>
      typeof date === "string" && DATE_PATTERN.test(date.trim()),
  );
  if (dates.length === 0) {
    return NextResponse.json(
      { error: "At least one valid date is required." },
      { status: 400 },
    );
  }

  const templateType = body.templateType;
  if (!templateType || !WEEK_TEMPLATES.includes(templateType)) {
    return NextResponse.json(
      { error: "A valid templateType is required." },
      { status: 400 },
    );
  }

  try {
    await applyTemplateToDates(ctx.allianceId, dates, templateType);
    return NextResponse.json({ ok: true, dates, templateType });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update schedule.";
    const status = message.includes("locked") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
