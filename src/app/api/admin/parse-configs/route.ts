import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { ExtractionConfig } from "@/lib/db/schema";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  const db = getDb();

  const rows = status
    ? await db
        .select()
        .from(schema.parseConfigs)
        .where(eq(schema.parseConfigs.status, status))
        .orderBy(desc(schema.parseConfigs.createdAt))
    : await db
        .select()
        .from(schema.parseConfigs)
        .orderBy(desc(schema.parseConfigs.createdAt));

  return NextResponse.json({ configs: rows });
}

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const body = (await request.json()) as {
    name?: string;
    passKey?: string;
    description?: string;
    configJson?: ExtractionConfig;
    notes?: string;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (!body.passKey?.trim()) {
    return NextResponse.json({ error: "passKey is required." }, { status: 400 });
  }
  if (!body.configJson || !body.configJson.mode) {
    return NextResponse.json(
      { error: "configJson must include a mode field." },
      { status: 400 },
    );
  }

  const db = getDb();

  const [sessionRow] = await db
    .select({ hqUserId: schema.sessions.hqUserId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  const id = nanoid(16);
  const now = new Date();

  await db.insert(schema.parseConfigs).values({
    id,
    name: body.name.trim(),
    passKey: body.passKey.trim(),
    description: body.description?.trim() ?? null,
    configJson: body.configJson,
    status: "draft",
    notes: body.notes?.trim() ?? null,
    createdByUserId: sessionRow?.hqUserId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const [config] = await db
    .select()
    .from(schema.parseConfigs)
    .where(eq(schema.parseConfigs.id, id))
    .limit(1);

  return NextResponse.json({ config });
}
