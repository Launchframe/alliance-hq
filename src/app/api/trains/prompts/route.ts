import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import {
  createPromptTemplateForActor,
  listPromptTemplatesForActor,
  loadPromptTemplateActor,
} from "@/lib/trains/prompt-templates.server";
import {
  PROMPT_TEMPLATE_TYPES,
  PROMPT_VISIBILITY_LEVELS,
  type ListPromptTemplatesQuery,
  type PromptTemplateType,
} from "@/lib/trains/prompt-templates.shared";
import { CONDUCTOR_MECHANISMS } from "@/lib/trains/types";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  templateType: z.enum(PROMPT_TEMPLATE_TYPES),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  visibility: z.enum(PROMPT_VISIBILITY_LEVELS),
  conductorMechanism: z.enum(CONDUCTOR_MECHANISMS).nullable().optional(),
  seasonKey: z.string().trim().max(16).nullable().optional(),
  eventTag: z.string().trim().max(64).nullable().optional(),
  targetConductorAshedMemberId: z.string().trim().nullable().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const actor = await loadPromptTemplateActor(session.id);
  if (!actor) {
    return NextResponse.json({ error: "No alliance context." }, { status: 400 });
  }

  const url = new URL(request.url);
  const rawType = url.searchParams.get("type");
  const rawVisibility = url.searchParams.get("visibility");
  const query: ListPromptTemplatesQuery = {
    ...(PROMPT_TEMPLATE_TYPES.includes(rawType as PromptTemplateType)
      ? { type: rawType as PromptTemplateType }
      : {}),
    ...(PROMPT_VISIBILITY_LEVELS.includes(
      rawVisibility as (typeof PROMPT_VISIBILITY_LEVELS)[number],
    )
      ? {
          visibility:
            rawVisibility as ListPromptTemplatesQuery["visibility"],
        }
      : {}),
    ...(url.searchParams.get("conductorMechanism")
      ? {
          conductorMechanism: url.searchParams.get(
            "conductorMechanism",
          ) as ListPromptTemplatesQuery["conductorMechanism"],
        }
      : {}),
    ...(url.searchParams.get("seasonKey")
      ? { seasonKey: url.searchParams.get("seasonKey")! }
      : {}),
    ...(url.searchParams.get("search")
      ? { search: url.searchParams.get("search")! }
      : {}),
    ...(url.searchParams.get("conductorMemberId")
      ? { conductorMemberId: url.searchParams.get("conductorMemberId")! }
      : {}),
  };

  const templates = await listPromptTemplatesForActor(actor, query);
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const actor = await loadPromptTemplateActor(session.id);
  if (!actor) {
    return NextResponse.json({ error: "No alliance context." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid prompt template payload." }, { status: 400 });
  }

  try {
    const template = await createPromptTemplateForActor(actor, parsed.data);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create prompt template.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
