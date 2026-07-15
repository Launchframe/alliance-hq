import { NextResponse, type NextRequest } from "next/server";
import { nanoid } from "nanoid";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { getOrCreateSession } from "@/lib/session";
import { getDb, schema } from "@/lib/db";
import { loadVsFixtureLibrary } from "@/lib/video/vs-fixture-library.server";

export const dynamic = "force-dynamic";

/** GET /api/dev/vs-score-fixtures — merged library (committed + workspace). */
export async function GET(): Promise<NextResponse> {
  if (!isDevOrPreviewEnvironment()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const templates = await loadVsFixtureLibrary();
  return NextResponse.json(templates);
}

/** POST /api/dev/vs-score-fixtures — save a scraped template to workspace DB. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isDevOrPreviewEnvironment()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const session = await getOrCreateSession();

  let body: {
    id?: string;
    name?: string;
    tags?: string[];
    kind?: string;
    allianceTag?: string;
    payload?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const kind = body.kind === "week" ? "week" : "day";
  const id = typeof body.id === "string" && body.id.trim()
    ? body.id.trim()
    : `ws-${nanoid(8)}`;

  const db = getDb();
  const now = new Date();

  await db
    .insert(schema.hqVsScoreFixtureTemplates)
    .values({
      id,
      name,
      tags: Array.isArray(body.tags) ? body.tags : [],
      kind,
      payload: body.payload ?? {},
      allianceTag: body.allianceTag ?? null,
      createdByHqUserId: session.hqUserId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.hqVsScoreFixtureTemplates.id,
      set: {
        name,
        tags: Array.isArray(body.tags) ? body.tags : [],
        payload: body.payload ?? {},
        allianceTag: body.allianceTag ?? null,
        updatedAt: now,
      },
    });

  return NextResponse.json({ ok: true, id });
}
