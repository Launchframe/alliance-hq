import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { confirmConductorPlacement } from "@/lib/trains/conductor-confirmation.server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  recordId: z.string().min(1),
});

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;

  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (!session.hqUserId) {
    return NextResponse.json({ error: "HQ account required." }, { status: 401 });
  }

  const result = await confirmConductorPlacement({
    allianceId: ctx.allianceId,
    recordId: parsed.data.recordId,
    officerHqUserId: session.hqUserId,
    sessionId: session.id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "confirm_failed" },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
