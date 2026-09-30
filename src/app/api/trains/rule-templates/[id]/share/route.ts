import { NextResponse } from "next/server";

import { writeTrainsOfficerAudit } from "@/lib/bff/officer-action-audit.server";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import {
  ShareNotAllowedError,
  createTemplateShareCode,
  revokeTemplateShareCode,
} from "@/lib/trains/rules/template-share.server";

export const dynamic = "force-dynamic";

/**
 * Create or rotate this template's share code.
 *
 * The plaintext code is returned **once**, here. It is stored hashed, so a
 * later read cannot recover it — rotate to get a new one.
 */
export async function POST(
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
  try {
    const { template, code, codeHint } = await createTemplateShareCode({
      allianceId: ctx.allianceId,
      templateId: id,
    });

    await writeTrainsOfficerAudit({
      sessionId: session.id,
      allianceId: ctx.allianceId,
      hqUserId: session.hqUserId,
      action: "trains.rule_template_share",
      severity: "update",
      resourceType: "train_rule_template",
      resourceId: id,
      // The code itself is a credential and never enters the audit log.
      metadata: { name: template.name, codeHint },
    });

    return NextResponse.json({ template, code, codeHint });
  } catch (error) {
    if (error instanceof ShareNotAllowedError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.message.includes("not found") ? 404 : 403 },
      );
    }
    throw error;
  }
}

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
  const template = await revokeTemplateShareCode({
    allianceId: ctx.allianceId,
    templateId: id,
  });
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  await writeTrainsOfficerAudit({
    sessionId: session.id,
    allianceId: ctx.allianceId,
    hqUserId: session.hqUserId,
    action: "trains.rule_template_share_revoke",
    severity: "update",
    resourceType: "train_rule_template",
    resourceId: id,
    metadata: { name: template.name },
  });

  return NextResponse.json({ template });
}
