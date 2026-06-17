import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
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

  const rows = await db
    .select({
      id: schema.configAssignments.id,
      scoreTarget: schema.configAssignments.scoreTarget,
      boardKey: schema.configAssignments.boardKey,
      configId: schema.configAssignments.configId,
      notes: schema.configAssignments.notes,
      createdAt: schema.configAssignments.createdAt,
      updatedAt: schema.configAssignments.updatedAt,
      configName: schema.parseConfigs.name,
      configPassKey: schema.parseConfigs.passKey,
    })
    .from(schema.configAssignments)
    .leftJoin(
      schema.parseConfigs,
      eq(schema.configAssignments.configId, schema.parseConfigs.id),
    )
    .orderBy(desc(schema.configAssignments.createdAt));

  const assignments = rows.map(({ configName, configPassKey, ...row }) => ({
    ...row,
    config:
      configName != null && configPassKey != null
        ? { name: configName, passKey: configPassKey }
        : null,
  }));

  return NextResponse.json({ assignments });
}

export async function POST(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const body = (await request.json()) as {
    scoreTarget?: string | null;
    boardKey?: string | null;
    configId?: string;
    notes?: string;
  };

  if (!body.configId?.trim()) {
    return NextResponse.json({ error: "configId is required." }, { status: 400 });
  }

  const db = getDb();

  // Confirm the config exists and is not archived
  const [config] = await db
    .select({ id: schema.parseConfigs.id, status: schema.parseConfigs.status })
    .from(schema.parseConfigs)
    .where(eq(schema.parseConfigs.id, body.configId.trim()))
    .limit(1);

  if (!config) {
    return NextResponse.json({ error: "Parse config not found." }, { status: 404 });
  }
  if (config.status === "archived") {
    return NextResponse.json(
      { error: "Cannot assign an archived parse config." },
      { status: 400 },
    );
  }

  const scoreTarget = body.scoreTarget?.trim() ?? null;
  const boardKey = body.boardKey?.trim() || null;

  // Check for a conflicting assignment at the same (scoreTarget, boardKey) scope.
  // The DB also enforces UNIQUE(score_target, board_key), so this gives a nicer error.
  const allAssignments = await db
    .select({
      scoreTarget: schema.configAssignments.scoreTarget,
      boardKey: schema.configAssignments.boardKey,
    })
    .from(schema.configAssignments);

  const duplicate = allAssignments.find(
    (a) => a.scoreTarget === scoreTarget && a.boardKey === boardKey,
  );

  if (duplicate) {
    return NextResponse.json(
      {
        error:
          "A config assignment already exists for this scope. Delete or update the existing assignment first.",
      },
      { status: 409 },
    );
  }

  const [sessionRow] = await db
    .select({ hqUserId: schema.sessions.hqUserId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  const id = nanoid(16);
  const now = new Date();

  await db.insert(schema.configAssignments).values({
    id,
    scoreTarget,
    boardKey,
    configId: body.configId.trim(),
    notes: body.notes?.trim() ?? null,
    createdByUserId: sessionRow?.hqUserId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const [assignment] = await db
    .select()
    .from(schema.configAssignments)
    .where(eq(schema.configAssignments.id, id))
    .limit(1);

  return NextResponse.json({ assignment });
}
