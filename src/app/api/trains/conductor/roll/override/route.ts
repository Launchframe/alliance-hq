import { NextResponse } from "next/server";
import { z } from "zod";

import { CONDUCTOR_MECHANISMS } from "@/lib/trains/types";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { getConductorStats } from "@/lib/trains/repository";
import { confirmConductorMinimumOverride } from "@/lib/trains/service";
import { getOrCreateSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  date: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
  memberName: z.string().trim().min(1),
  mechanism: z.enum(CONDUCTOR_MECHANISMS),
  overrideReason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireTrainOfficer(session.id);
  if (denied) return denied;

  const ctx = await resolveTrainRequestContext();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid override payload." }, { status: 400 });
  }

  try {
    const result = await confirmConductorMinimumOverride({
      allianceId: ctx.allianceId,
      date: parsed.data.date,
      memberId: parsed.data.memberId,
      memberName: parsed.data.memberName,
      mechanism: parsed.data.mechanism,
      connection: ctx.connection,
      ashedAllianceId: ctx.ashedAllianceId,
      overrideReason: parsed.data.overrideReason,
      sessionId: session.id,
      hqUserId: session.hqUserId,
    });

    const stats = await getConductorStats(ctx.allianceId, result.memberId);

    return NextResponse.json({ result, stats });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Override failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
