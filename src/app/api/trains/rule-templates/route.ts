import { NextResponse } from "next/server";
import { z } from "zod";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { sessionHasPermission } from "@/lib/rbac/context";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import {
  RuleTemplateNameTakenError,
  createRuleTemplate,
  listRuleTemplatesForAlliance,
} from "@/lib/trains/rules/templates.server";
import { templateWeekRulesSchema } from "@/lib/trains/rules/template-days.shared";

export const dynamic = "force-dynamic";

const createBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(280).nullish(),
  days: templateWeekRulesSchema,
  /** Set when copying an existing template this alliance can see. */
  sourceTemplateId: z.string().max(64).nullish(),
});

/** Reading templates only needs the same permission as reading the schedule. */
export async function GET() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const denied = await requireSessionPermission(
    sessionOrError.id,
    "scores:read",
  );
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json({
    templates: await listRuleTemplatesForAlliance(ctx.allianceId),
    // Reported here so the manager does not have to probe a mutation route
    // just to decide whether to render its buttons.
    canManage: await sessionHasPermission(sessionOrError.id, "trains:write"),
  });
}

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = createBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "A template name and seven day rules are required.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  try {
    const template = await createRuleTemplate({
      allianceId: ctx.allianceId,
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      days: parsed.data.days,
      createdByHqUserId: session.hqUserId ?? null,
      sourceTemplateId: parsed.data.sourceTemplateId ?? null,
    });

    await writeTrainsOfficerAudit({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId,
      action: "trains.rule_template_create",
      severity: "routine",
      resourceType: "train_rule_template",
      resourceId: template.id,
      metadata: {
        name: template.name,
        sourceTemplateId: template.sourceTemplateId,
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof RuleTemplateNameTakenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
