import { NextResponse } from "next/server";
import { z } from "zod";

import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import {
  getCommanderByAshedMemberId,
  setWeeklyPass,
} from "@/lib/vr/repository";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ashedMemberId: z.string().trim().min(1),
  active: z.boolean(),
});

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const commander = await getCommanderByAshedMemberId(
    body.ashedMemberId,
    allianceId,
  );
  if (!commander) {
    return NextResponse.json(
      { error: "Commander not found in this alliance." },
      { status: 404 },
    );
  }

  await setWeeklyPass({
    commanderId: commander.commanderId,
    active: body.active,
    source: "officer",
  });

  return NextResponse.json({ ok: true });
}
