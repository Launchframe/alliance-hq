import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

type Props = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: Props) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { id } = await params;
  const body = (await request.json()) as {
    label?: string;
    sortOrder?: number;
    active?: boolean;
  };

  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.hqCommendations)
    .where(eq(schema.hqCommendations.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(schema.hqCommendations)
    .set({
      ...(body.label !== undefined ? { label: body.label.trim() } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.active !== undefined ? { active: body.active ? 1 : 0 } : {}),
    })
    .where(eq(schema.hqCommendations.id, id));

  const [commendation] = await db
    .select()
    .from(schema.hqCommendations)
    .where(eq(schema.hqCommendations.id, id))
    .limit(1);

  return NextResponse.json({ commendation });
}
