import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  serializeEurScheduleRule,
  validateEurSchedulePayload,
  type EurSchedulePayload,
} from "@/lib/eur/schedule-api";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession, readSessionId } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: Props) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requireSessionPermission(sessionId, "eur:schedules:write");
  if (denied) return denied;

  const session = await getOrCreateSession();
  const allianceId = session.currentAllianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance context" }, { status: 400 });
  }

  const { id } = await params;
  const body = (await request.json()) as EurSchedulePayload;
  const validationError = validateEurSchedulePayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const db = getDb();
  const updated = await db
    .update(schema.eurScheduleRules)
    .set({
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
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.eurScheduleRules.id, id),
        eq(schema.eurScheduleRules.allianceId, allianceId),
      ),
    )
    .returning();

  if (updated.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    schedule: serializeEurScheduleRule(updated[0]),
  });
}

export async function DELETE(_request: Request, { params }: Props) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requireSessionPermission(sessionId, "eur:schedules:write");
  if (denied) return denied;

  const session = await getOrCreateSession();
  const allianceId = session.currentAllianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance context" }, { status: 400 });
  }

  const { id } = await params;
  const db = getDb();
  const deleted = await db
    .delete(schema.eurScheduleRules)
    .where(
      and(
        eq(schema.eurScheduleRules.id, id),
        eq(schema.eurScheduleRules.allianceId, allianceId),
      ),
    )
    .returning({ id: schema.eurScheduleRules.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
