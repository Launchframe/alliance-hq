import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { generateConductorDraftImages } from "@/lib/trains/conductor-images.server";
import { IMAGE_MODEL_PROVIDERS } from "@/lib/trains/prompt-templates.shared";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  promptBody: z.string().trim().min(1).max(8000),
  promptTemplateId: z.string().trim().nullable().optional(),
  modelProvider: z.enum(IMAGE_MODEL_PROVIDERS),
  modelType: z.string().trim().nullable().optional(),
  portraitUrl: z.string().trim().nullable().optional(),
});

type RouteContext = { params: Promise<{ recordId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid image generation payload." }, { status: 400 });
  }

  const { recordId } = await context.params;

  try {
    const image = await generateConductorDraftImages({
      allianceId: ctx.allianceId,
      conductorRecordId: recordId,
      hqUserId: session.hqUserId,
      promptBody: parsed.data.promptBody,
      promptTemplateId: parsed.data.promptTemplateId ?? null,
      modelProvider: parsed.data.modelProvider,
      modelType: parsed.data.modelType ?? "art",
      portraitUrl: parsed.data.portraitUrl ?? null,
    });
    return NextResponse.json({ image }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
