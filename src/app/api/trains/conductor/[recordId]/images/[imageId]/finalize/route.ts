import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { finalizeConductorDraftImage } from "@/lib/trains/conductor-images.server";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  selectedExternalUrl: z.string().trim().min(1),
});

type RouteContext = {
  params: Promise<{ recordId: string; imageId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid finalize payload." }, { status: 400 });
  }

  const { recordId, imageId } = await context.params;

  try {
    const image = await finalizeConductorDraftImage({
      allianceId: ctx.allianceId,
      conductorRecordId: recordId,
      imageId,
      selectedExternalUrl: parsed.data.selectedExternalUrl,
    });
    return NextResponse.json({ image });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to finalize image.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
