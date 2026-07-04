import { NextResponse } from "next/server";
import { z } from "zod";

import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import {
  getCommanderByAshedMemberId,
  setWeeklyPass,
} from "@/lib/vr/repository";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  active: z.boolean(),
});

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:read");
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

  const link = await getHqMemberLinkForUser(allianceId, session.hqUserId);
  if (!link) {
    return NextResponse.json(
      { code: "member_link_required", error: "Link your commander first." },
      { status: 403 },
    );
  }

  const commander = await getCommanderByAshedMemberId(
    link.ashedMemberId,
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
    source: "self",
  });

  return NextResponse.json({ ok: true });
}
