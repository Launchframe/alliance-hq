import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildAllianceSetupStatusPayload,
  updateAllianceSetupGuidePrefs,
} from "@/lib/alliance-setup-guide-status-api";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const payload = await buildAllianceSetupStatusPayload({
    allianceId,
    hqUserId: session.hqUserId,
    sessionId: session.id,
  });

  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(payload);
}

const patchSchema = z.object({
  setupGuideDismissed: z.boolean().optional(),
  setupGuideShowOnDashboard: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  await updateAllianceSetupGuidePrefs({
    allianceId,
    hqUserId: session.hqUserId,
    ...body,
  });

  const payload = await buildAllianceSetupStatusPayload({
    allianceId,
    hqUserId: session.hqUserId,
    sessionId: session.id,
  });

  return NextResponse.json(payload);
}
