import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  getPromptTemplateForActor,
  loadPromptTemplateActor,
  updatePromptTemplateForActor,
} from "@/lib/trains/prompt-templates.server";
import {
  PROMPT_VISIBILITY_LEVELS,
} from "@/lib/trains/prompt-templates.shared";
import { CONDUCTOR_MECHANISMS } from "@/lib/trains/types";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(8000).optional(),
  visibility: z.enum(PROMPT_VISIBILITY_LEVELS).optional(),
  conductorMechanism: z.enum(CONDUCTOR_MECHANISMS).nullable().optional(),
  seasonKey: z.string().trim().max(16).nullable().optional(),
  eventTag: z.string().trim().max(64).nullable().optional(),
  targetConductorAshedMemberId: z.string().trim().nullable().optional(),
  isDefault: z.boolean().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const actor = await loadPromptTemplateActor(session.id);
  if (!actor) {
    return NextResponse.json({ error: "No alliance context." }, { status: 400 });
  }

  const { id } = await context.params;
  const template = await getPromptTemplateForActor(actor, id);
  if (!template) {
    return NextResponse.json({ error: "Prompt template not found." }, { status: 404 });
  }

  return NextResponse.json({ template });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const actor = await loadPromptTemplateActor(session.id);
  if (!actor) {
    return NextResponse.json({ error: "No alliance context." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid prompt template payload." }, { status: 400 });
  }

  const { id } = await context.params;

  try {
    const template = await updatePromptTemplateForActor(actor, id, parsed.data);
    return NextResponse.json({ template });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update prompt template.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
