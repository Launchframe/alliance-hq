import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** PATCH /api/dev/vs-score-fixtures/:id — rename / retag workspace template. */
export async function PATCH(
  request: NextRequest,
  { params }: Props,
): Promise<NextResponse> {
  if (!isDevOrPreviewEnvironment()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { id } = await params;
  let body: { name?: string; tags?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.name === "string") set.name = body.name.trim();
  if (Array.isArray(body.tags)) set.tags = body.tags;

  const [updated] = await db
    .update(schema.hqVsScoreFixtureTemplates)
    .set(set)
    .where(eq(schema.hqVsScoreFixtureTemplates.id, id))
    .returning({ id: schema.hqVsScoreFixtureTemplates.id });

  if (!updated) {
    return NextResponse.json(
      { error: "Template not found or is committed (read-only)." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/dev/vs-score-fixtures/:id — remove workspace template only. */
export async function DELETE(
  _request: NextRequest,
  { params }: Props,
): Promise<NextResponse> {
  if (!isDevOrPreviewEnvironment()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { id } = await params;
  const db = getDb();

  const [deleted] = await db
    .delete(schema.hqVsScoreFixtureTemplates)
    .where(eq(schema.hqVsScoreFixtureTemplates.id, id))
    .returning({ id: schema.hqVsScoreFixtureTemplates.id });

  if (!deleted) {
    return NextResponse.json(
      { error: "Template not found or is committed (read-only)." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
