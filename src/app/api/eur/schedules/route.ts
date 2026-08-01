import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  serializeEurScheduleRule,
  validateEurSchedulePayload,
  type EurSchedulePayload,
} from "@/lib/eur/schedule-api";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "inbox:read");
  if (denied) return denied;

  const allianceId = session.currentAllianceId;
  if (!allianceId) {
    return NextResponse.json({ schedules: [] });
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.eurScheduleRules)
    .where(eq(schema.eurScheduleRules.allianceId, allianceId))
    .orderBy(asc(schema.eurScheduleRules.createdAt));

  return NextResponse.json({
    schedules: rows.map(serializeEurScheduleRule),
  });
}

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const denied = await requireSessionPermission(session.id, "eur:schedules:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance context" }, { status: 400 });
  }

  const body = (await request.json()) as EurSchedulePayload;
  const validationError = validateEurSchedulePayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const now = new Date();
  const id = nanoid(16);
  const db = getDb();

  await db.insert(schema.eurScheduleRules).values({
    id,
    allianceId,
    scoreTarget: body.scoreTarget?.trim() || null,
    customLabel: body.customLabel?.trim() || null,
    scheduleKind: body.scheduleKind,
    weeklySlots:
      body.scheduleKind === "weekly" ? (body.weeklySlots ?? null) : null,
    intervalDays:
      body.scheduleKind === "interval_after_last"
        ? (body.intervalDays ?? null)
        : null,
    anchorTimeSt:
      body.scheduleKind === "interval_after_last"
        ? (body.anchorTimeSt ?? null)
        : null,
    reminderDelayMinutes: body.reminderDelayMinutes ?? 60,
    active: body.active === false ? 0 : 1,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db
    .select()
    .from(schema.eurScheduleRules)
    .where(eq(schema.eurScheduleRules.id, id))
    .limit(1);

  return NextResponse.json({ schedule: serializeEurScheduleRule(row) });
}
