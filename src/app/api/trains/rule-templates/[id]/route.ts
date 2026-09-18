import { NextResponse } from "next/server";
import { z } from "zod";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  RuleTemplateNameTakenError,
  archiveRuleTemplate,
  getRuleTemplateForAlliance,
  updateRuleTemplate,
} from "@/lib/trains/rules/templates.server";
import { templateWeekRulesSchema } from "@/lib/trains/rules/template-days.shared";

export const dynamic = "force-dynamic";

const patchBodySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(280).nullable().optional(),
  days: templateWeekRulesSchema.optional(),
  /** Hide (or restore) this template for the alliance. */
  archived: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const existing = await getRuleTemplateForAlliance(ctx.allianceId, id);
  if (!existing) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const parsed = patchBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid template update.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const { archived, ...edits } = parsed.data;
  const editsRequested = Object.keys(edits).length > 0;

  // Presets belong to HQ: an alliance may hide one, never rewrite it.
  if (existing.isPreset && editsRequested) {
    return NextResponse.json(
      { error: "Preset templates cannot be edited. Copy it first." },
      { status: 403 },
    );
  }

  try {
    let template = existing;
    if (editsRequested) {
      const updated = await updateRuleTemplate({
        allianceId: ctx.allianceId,
        templateId: id,
        ...edits,
      });
      if (!updated) {
        return NextResponse.json(
          { error: "Template not found." },
          { status: 404 },
        );
      }
      template = updated;
    }

    if (archived !== undefined && archived !== existing.archived) {
      const toggled = await archiveRuleTemplate({
        allianceId: ctx.allianceId,
        templateId: id,
        hqUserId: session.hqUserId ?? null,
        archived,
      });
      if (toggled) template = toggled;
    }

    await writeTrainsOfficerAudit({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId,
      action:
        archived !== undefined && archived !== existing.archived
          ? archived
            ? "trains.rule_template_archive"
            : "trains.rule_template_restore"
          : "trains.rule_template_update",
      severity: "update",
      resourceType: "train_rule_template",
      resourceId: id,
      metadata: {
        name: template.name,
        isPreset: template.isPreset,
        archived: template.archived,
      },
    });

    return NextResponse.json({ template });
  } catch (error) {
    if (error instanceof RuleTemplateNameTakenError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

/**
 * Soft delete, so days already painted from this template keep resolving and
 * the audit trail still points at a real row. Presets are archived instead.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const existing = await getRuleTemplateForAlliance(ctx.allianceId, id);
  if (!existing) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const template = await archiveRuleTemplate({
    allianceId: ctx.allianceId,
    templateId: id,
    hqUserId: session.hqUserId ?? null,
    archived: true,
  });

  await writeTrainsOfficerAudit({
    sessionId: session.id,
    allianceId: ctx.allianceId,
    hqUserId: session.hqUserId,
    action: "trains.rule_template_archive",
    severity: "update",
    resourceType: "train_rule_template",
    resourceId: id,
    metadata: { name: existing.name, isPreset: existing.isPreset },
  });

  return NextResponse.json({ template });
}
