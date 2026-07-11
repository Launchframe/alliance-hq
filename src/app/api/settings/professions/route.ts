import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "alliance:admin");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const db = getDb();
  const [alliance] = await db
    .select({ wlMinEngsPerTeam: schema.alliances.wlMinEngsPerTeam })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return NextResponse.json({
    wlMinEngsPerTeam: alliance?.wlMinEngsPerTeam ?? 2,
  });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "alliance:admin");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const body = (await request.json()) as { wlMinEngsPerTeam?: unknown };
  const raw = Number(body.wlMinEngsPerTeam);
  if (!Number.isInteger(raw) || raw < 1 || raw > 10) {
    return NextResponse.json(
      { error: "wlMinEngsPerTeam must be an integer between 1 and 10." },
      { status: 400 },
    );
  }

  const db = getDb();
  await db
    .update(schema.alliances)
    .set({ wlMinEngsPerTeam: raw, updatedAt: new Date() })
    .where(eq(schema.alliances.id, allianceId));

  return NextResponse.json({ ok: true, wlMinEngsPerTeam: raw });
}
