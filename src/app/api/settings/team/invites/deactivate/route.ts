import { NextResponse } from "next/server";
import { z } from "zod";

import { eq, and } from "drizzle-orm";

import { listAccessibleInventoryAlliances } from "@/lib/native-alliance/invite-inventory.server";
import { resolveTeamInviteAccess } from "@/lib/native-alliance/team-invites.server";
import { readSessionId, loadSession } from "@/lib/session";
import { getDb, schema } from "@/lib/db";

const bodySchema = z.object({
  kind: z.enum(["invite_link", "join_code", "commander_claim"]),
  id: z.string().min(1).max(128),
  allianceId: z.string().min(1).max(128).optional(),
});

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await resolveTeamInviteAccess(sessionId);
  if (access instanceof NextResponse) {
    return access;
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  let allianceId = access.allianceId;
  if (body.allianceId && body.allianceId !== access.allianceId) {
    const session = await loadSession(sessionId);
    const hqUserId = session?.hqUserId ?? access.ctx.hqUserId;
    const accessible = await listAccessibleInventoryAlliances(hqUserId);
    const allowed =
      access.ctx.isPlatformMaintainer ||
      accessible.some((a) => a.id === body.allianceId);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    allianceId = body.allianceId;
  }

  const db = getDb();
  const now = new Date();

  if (body.kind === "invite_link") {
    const [row] = await db
      .select({ id: schema.hqInvites.id, revokedAt: schema.hqInvites.revokedAt })
      .from(schema.hqInvites)
      .where(
        and(
          eq(schema.hqInvites.id, body.id),
          eq(schema.hqInvites.allianceId, allianceId),
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    }
    if (row.revokedAt) {
      return NextResponse.json({ error: "Invite is already deactivated." }, { status: 409 });
    }

    await db
      .update(schema.hqInvites)
      .set({ revokedAt: now })
      .where(eq(schema.hqInvites.id, body.id));

    return NextResponse.json({ ok: true });
  }

  // join_code and commander_claim both live in hq_alliance_join_codes
  const [row] = await db
    .select({
      id: schema.hqAllianceJoinCodes.id,
      revokedAt: schema.hqAllianceJoinCodes.revokedAt,
    })
    .from(schema.hqAllianceJoinCodes)
    .where(
      and(
        eq(schema.hqAllianceJoinCodes.id, body.id),
        eq(schema.hqAllianceJoinCodes.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Join code not found." }, { status: 404 });
  }
  if (row.revokedAt) {
    return NextResponse.json({ error: "Join code is already deactivated." }, { status: 409 });
  }

  await db
    .update(schema.hqAllianceJoinCodes)
    .set({ revokedAt: now })
    .where(eq(schema.hqAllianceJoinCodes.id, body.id));

  return NextResponse.json({ ok: true });
}
