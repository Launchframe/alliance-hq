import { NextResponse } from "next/server";
import { z } from "zod";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { loadAllianceTrainLeadTimeDays } from "@/lib/trains/alliance-train-lead-time.server";
import {
  RuleTemplateNameTakenError,
  createRuleTemplate,
} from "@/lib/trains/rules/templates.server";
import { previewSharedTemplate } from "@/lib/trains/rules/template-share.server";
import { validateTemplateWeekRules } from "@/lib/trains/rules/template-days.shared";

export const dynamic = "force-dynamic";

const importBodySchema = z.object({
  code: z.string().trim().min(1).max(32),
  /** Optional rename, for when the incoming name collides. */
  name: z.string().trim().min(1).max(60).optional(),
});

/**
 * Preview a shared template before importing it.
 *
 * Warnings are computed against the **importing** alliance's lead time, not
 * the author's: the same seven rules can be sound for one alliance and leave
 * a wheel with nothing to draw from for another.
 */
export async function GET(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const denied = await requireTrainOfficer(sessionOrError.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const code = new URL(request.url).searchParams.get("code") ?? "";
  const preview = await previewSharedTemplate({
    allianceId: ctx.allianceId,
    code,
  });
  if (!preview) {
    return NextResponse.json(
      { error: "That share code is not valid." },
      { status: 404 },
    );
  }

  const leadDays = await loadAllianceTrainLeadTimeDays(ctx.allianceId);
  return NextResponse.json({
    preview,
    leadDays,
    warnings: validateTemplateWeekRules(preview.days, leadDays),
  });
}

/**
 * Import by **copy**. The new row is owned by the importing alliance, so the
 * two diverge from here and revoking the code cannot change a schedule
 * someone is already running.
 */
export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = importBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A share code is required." },
      { status: 400 },
    );
  }

  const preview = await previewSharedTemplate({
    allianceId: ctx.allianceId,
    code: parsed.data.code,
  });
  if (!preview) {
    return NextResponse.json(
      { error: "That share code is not valid." },
      { status: 404 },
    );
  }

  try {
    const template = await createRuleTemplate({
      allianceId: ctx.allianceId,
      name: parsed.data.name ?? preview.name,
      description: preview.description,
      days: preview.days,
      createdByHqUserId: session.hqUserId ?? null,
      sourceTemplateId: preview.sourceTemplateId,
    });

    await writeTrainsOfficerAudit({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId,
      action: "trains.rule_template_import",
      severity: "routine",
      resourceType: "train_rule_template",
      resourceId: template.id,
      metadata: {
        name: template.name,
        sourceTemplateId: preview.sourceTemplateId,
        sourceAllianceTag: preview.sourceAllianceTag,
      },
    });

    const leadDays = await loadAllianceTrainLeadTimeDays(ctx.allianceId);
    return NextResponse.json(
      {
        template,
        // Surfaced again on success: the importer should see the warnings
        // even if they skipped the preview.
        warnings: validateTemplateWeekRules(template.days, leadDays),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RuleTemplateNameTakenError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "name_taken",
          suggestedName: `${preview.name} (${ctx.allianceId.slice(0, 4)})`,
        },
        { status: 409 },
      );
    }
    throw error;
  }
}
