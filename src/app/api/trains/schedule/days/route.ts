import { NextResponse } from "next/server";
import { z } from "zod";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  applyPaint,
  getServerCalendarDate,
  trainActionErrorResponse,
} from "@/lib/trains/service";
import { canOfficerChangeTemplateForDate } from "@/lib/trains/trains-day-actions.shared";
import {
  conductorRuleSchema,
  vipRuleSchema,
} from "@/lib/trains/rules/catalog.shared";
import { WEEK_TEMPLATES, type WeekTemplateType } from "@/lib/trains/types";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A paint patches each side independently. `conductorRule: null` is free
 * choice and `vipRule: null` is the conductor's pick — both are deliberate
 * values. An omitted side preserves the day's current rule, so a VIP-only
 * paint can never reset the conductor scope on its way through.
 */
const paintBodySchema = z
  .object({
    dates: z.array(z.string().regex(DATE_PATTERN)).min(1),
    conductorRule: conductorRuleSchema.nullable().optional(),
    vipRule: vipRuleSchema.nullable().optional(),
    /** Preset to stamp on the week schedule when this paint sets one. */
    updateWeekTemplate: z.enum(WEEK_TEMPLATES).nullish(),
    /** Preset to persist when materializing a draft week on first paint. */
    preferredWeekTemplate: z.enum(WEEK_TEMPLATES).nullish(),
    /** Provenance for the calendar cell — never a draw input. */
    sourceTemplateKey: z.string().max(64).nullish(),
  })
  .refine(
    (body) => body.conductorRule !== undefined || body.vipRule !== undefined,
    { message: "Choose a conductor rule, a VIP rule, or both." },
  );

export async function GET() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const isPlatformAdmin = await sessionHasPermission(session.id, "hq:admin");
  const today = getServerCalendarDate();

  return NextResponse.json({
    today,
    canPaintPastDays: isPlatformAdmin,
    canOfficerPaintPastDays: false,
    officerPaintAllowedFrom: today,
  });
}

export async function PATCH(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = paintBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Choose a conductor rule, a VIP rule, or both.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const dates = [...new Set(body.dates)].sort();

  const isPlatformAdmin = await sessionHasPermission(session.id, "hq:admin");
  const today = getServerCalendarDate();
  const blockedPastDates = dates.filter(
    (date) => !canOfficerChangeTemplateForDate(date, today),
  );
  if (blockedPastDates.length > 0 && !isPlatformAdmin) {
    return NextResponse.json(
      { error: `Cannot change the rule for past day ${blockedPastDates[0]}.` },
      { status: 409 },
    );
  }

  try {
    await applyPaint(
      ctx.allianceId,
      {
        dates,
        conductorRule: body.conductorRule,
        vipRule: body.vipRule,
        sourceTemplateKey: body.sourceTemplateKey ?? null,
      },
      {
        platformAdminPastOverride: isPlatformAdmin,
        updateWeekTemplate:
          (body.updateWeekTemplate as WeekTemplateType | null) ?? null,
        ...(body.preferredWeekTemplate
          ? {
              preferredWeekTemplate:
                body.preferredWeekTemplate as WeekTemplateType,
            }
          : {}),
      },
    );
    await writeTrainsOfficerAudit({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId,
      action: "trains.schedule_paint_days",
      severity:
        blockedPastDates.length > 0 && isPlatformAdmin ? "override" : "update",
      resourceType: "train_day_config",
      resourceId: ctx.allianceId,
      metadata: {
        dates,
        ...(body.conductorRule !== undefined
          ? { conductorRule: body.conductorRule }
          : {}),
        ...(body.vipRule !== undefined ? { vipRule: body.vipRule } : {}),
        updateWeekTemplate: body.updateWeekTemplate ?? null,
        pastDayOverride: blockedPastDates.length > 0 && isPlatformAdmin,
        pastDates: blockedPastDates,
      },
    });
    return NextResponse.json({
      ok: true,
      dates,
      ...(body.conductorRule !== undefined
        ? { conductorRule: body.conductorRule }
        : {}),
      ...(body.vipRule !== undefined ? { vipRule: body.vipRule } : {}),
    });
  } catch (error) {
    const { status, body: responseBody } = trainActionErrorResponse(error);
    return NextResponse.json(responseBody, { status });
  }
}
