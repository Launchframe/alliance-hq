import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession, readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

function serializeSubscription(row: {
  id: string;
  hqUserId: string;
  allianceId: string;
  scoreTarget: string;
  cadence: string;
  cadenceConfig: unknown;
  reminderDelayMinutes: number;
  nextDueAt: Date | null;
  active: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    scoreTarget: row.scoreTarget,
    cadence: row.cadence,
    cadenceConfig: row.cadenceConfig,
    reminderDelayMinutes: row.reminderDelayMinutes,
    nextDueAt: row.nextDueAt?.toISOString() ?? null,
    active: row.active === 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requireSessionPermission(sessionId, "inbox:read");
  if (denied) return denied;

  const session = await getOrCreateSession();
  if (!session.hqUserId || !session.currentAllianceId) {
    return NextResponse.json({ subscriptions: [] });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.eurUserSubscriptions)
    .where(
      and(
        eq(schema.eurUserSubscriptions.hqUserId, session.hqUserId),
        eq(schema.eurUserSubscriptions.allianceId, session.currentAllianceId),
      ),
    );

  return NextResponse.json({
    subscriptions: rows.map(serializeSubscription),
  });
}

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requireSessionPermission(sessionId, "inbox:read");
  if (denied) return denied;

  const session = await getOrCreateSession();
  if (!session.hqUserId || !session.currentAllianceId) {
    return NextResponse.json({ error: "No alliance context" }, { status: 400 });
  }

  const body = (await request.json()) as {
    scoreTarget?: string;
    active?: boolean;
    cadence?: string;
    reminderDelayMinutes?: number;
  };

  if (!body.scoreTarget?.trim()) {
    return NextResponse.json({ error: "scoreTarget is required." }, { status: 400 });
  }

  const now = new Date();
  const id = nanoid(16);
  const db = getDb();

  await db
    .insert(schema.eurUserSubscriptions)
    .values({
      id,
      hqUserId: session.hqUserId,
      allianceId: session.currentAllianceId,
      scoreTarget: body.scoreTarget.trim(),
      cadence: body.cadence ?? "weekly",
      cadenceConfig: null,
      reminderDelayMinutes: body.reminderDelayMinutes ?? 0,
      active: body.active === false ? 0 : 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.eurUserSubscriptions.hqUserId,
        schema.eurUserSubscriptions.allianceId,
        schema.eurUserSubscriptions.scoreTarget,
      ],
      set: {
        active: body.active === false ? 0 : 1,
        cadence: body.cadence ?? "weekly",
        reminderDelayMinutes: body.reminderDelayMinutes ?? 0,
        updatedAt: now,
      },
    });

  const [row] = await db
    .select()
    .from(schema.eurUserSubscriptions)
    .where(
      and(
        eq(schema.eurUserSubscriptions.hqUserId, session.hqUserId),
        eq(schema.eurUserSubscriptions.allianceId, session.currentAllianceId),
        eq(schema.eurUserSubscriptions.scoreTarget, body.scoreTarget.trim()),
      ),
    )
    .limit(1);

  return NextResponse.json({ subscription: serializeSubscription(row) });
}
