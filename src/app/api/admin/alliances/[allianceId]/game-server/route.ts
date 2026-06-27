import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/bff/audit";
import {
  resolveAllianceGameServerNumber,
} from "@/lib/game-season/game-servers.server";
import { updateAllianceGameServerNumber } from "@/lib/game-season/sync";
import { isNativeAlliance } from "@/lib/native-alliance/operating-mode";
import { getRbacContext } from "@/lib/rbac/context";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { getAllianceById } from "@/lib/vr/repository";

const bodySchema = z.object({
  gameServerNumber: z.number().int().positive().max(9999),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ allianceId: string }> },
) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { allianceId } = await context.params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const alliance = await getAllianceById(allianceId);
  if (!alliance) {
    return NextResponse.json({ error: "Alliance not found." }, { status: 404 });
  }

  const native = await isNativeAlliance(allianceId);
  if (!native) {
    return NextResponse.json(
      {
        error:
          "Game server number is managed by Ashed for connected alliances.",
      },
      { status: 400 },
    );
  }

  const before = await resolveAllianceGameServerNumber(allianceId);
  await updateAllianceGameServerNumber(allianceId, parsed.data.gameServerNumber);
  const after = await resolveAllianceGameServerNumber(allianceId);

  if (before !== after) {
    const ctx = await getRbacContext(sessionId);
    await writeAuditLog({
      sessionId,
      allianceId,
      hqUserId: ctx?.hqUserId ?? undefined,
      action: "alliance.game_server_update",
      resourceType: "alliance",
      resourceId: allianceId,
      resourceName: alliance.name,
      metadata: {
        before: { gameServerNumber: before },
        after: { gameServerNumber: after },
        via: "admin_console",
      },
    });
  }

  return NextResponse.json({ ok: true, gameServerNumber: after });
}
