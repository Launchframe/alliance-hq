import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const session = await getOrCreateSession();
    const url = new URL(request.url);
    const scoreTarget = url.searchParams.get("scoreTarget");
    const allianceId = session.allianceId;

    if (!allianceId) {
      return NextResponse.json(
        { error: "Alliance context required." },
        { status: 400 },
      );
    }

    const db = getDb();
    const conditions = [eq(schema.hqEvents.allianceId, allianceId)];
    if (scoreTarget) {
      conditions.push(eq(schema.hqEvents.scoreTarget, scoreTarget));
    }

    const events = await db
      .select()
      .from(schema.hqEvents)
      .where(and(...conditions))
      .orderBy(desc(schema.hqEvents.createdAt));

    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list events" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    const allianceId = session.allianceId;
    if (!allianceId) {
      return NextResponse.json(
        { error: "Alliance context required." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      scoreTarget: string;
      name: string;
      startDate?: string;
      endDate?: string;
      status?: string;
    };

    if (!body.scoreTarget || !body.name) {
      return NextResponse.json(
        { error: "scoreTarget and name are required." },
        { status: 400 },
      );
    }

    const id = nanoid(16);
    const now = new Date();
    const db = getDb();

    await db.insert(schema.hqEvents).values({
      id,
      allianceId,
      scoreTarget: body.scoreTarget,
      name: body.name,
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      status: body.status ?? "active",
      createdAt: now,
      updatedAt: now,
    });

    const [event] = await db
      .select()
      .from(schema.hqEvents)
      .where(eq(schema.hqEvents.id, id))
      .limit(1);

    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create event" },
      { status: 500 },
    );
  }
}
