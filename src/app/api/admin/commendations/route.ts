import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const db = getDb();
  const commendations = await db
    .select()
    .from(schema.hqCommendations)
    .orderBy(asc(schema.hqCommendations.sortOrder));

  return NextResponse.json({ commendations });
}

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const body = (await request.json()) as {
    slug?: string;
    label?: string;
    sortOrder?: number;
    active?: boolean;
  };

  const slug = body.slug?.trim().toLowerCase();
  const label = body.label?.trim();
  if (!slug || !label) {
    return NextResponse.json(
      { error: "slug and label are required." },
      { status: 400 },
    );
  }

  const id = nanoid(12);
  const now = new Date();
  const db = getDb();

  await db.insert(schema.hqCommendations).values({
    id,
    slug,
    label,
    sortOrder: body.sortOrder ?? 0,
    active: body.active === false ? 0 : 1,
    createdAt: now,
  });

  const [commendation] = await db
    .select()
    .from(schema.hqCommendations)
    .where(eq(schema.hqCommendations.id, id))
    .limit(1);

  return NextResponse.json({ commendation });
}
