import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

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
  const rows = await db
    .select({
      id: schema.gameSeasons.id,
      seasonNumber: schema.gameSeasons.seasonNumber,
      maxProfessionLevel: schema.gameSeasons.maxProfessionLevel,
    })
    .from(schema.gameSeasons)
    .orderBy(asc(schema.gameSeasons.seasonNumber));

  return NextResponse.json({ seasons: rows });
}

const patchSchema = z.object({
  seasonId: z.string().trim().min(1),
  maxProfessionLevel: z.number().int().min(1).nullable().optional(),
});

export async function PATCH(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(schema.gameSeasons)
    .set({
      ...(body.maxProfessionLevel !== undefined
        ? { maxProfessionLevel: body.maxProfessionLevel }
        : {}),
      updatedAt: now,
    })
    .where(eq(schema.gameSeasons.id, body.seasonId))
    .returning({
      id: schema.gameSeasons.id,
      seasonNumber: schema.gameSeasons.seasonNumber,
      maxProfessionLevel: schema.gameSeasons.maxProfessionLevel,
    });

  if (!updated) {
    return NextResponse.json({ error: "Season not found" }, { status: 404 });
  }

  return NextResponse.json({ season: updated });
}
