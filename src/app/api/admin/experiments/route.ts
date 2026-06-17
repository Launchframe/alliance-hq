import { NextResponse } from "next/server";
import { count, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
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
        .from(schema.experimentCampaigns)
        .where(eq(schema.experimentCampaigns.status, status))
        .orderBy(desc(schema.experimentCampaigns.createdAt))
    : await db
        .select()
        .from(schema.experimentCampaigns)
        .orderBy(desc(schema.experimentCampaigns.createdAt));

  const armCounts = await db
    .select({
      campaignId: schema.experimentArms.campaignId,
      armCount: count(),
    })
    .from(schema.experimentArms)
    .groupBy(schema.experimentArms.campaignId);

  const armCountMap = new Map(armCounts.map((r) => [r.campaignId, r.armCount]));

  const campaigns = rows.map((campaign) => ({
    ...campaign,
    armCount: armCountMap.get(campaign.id) ?? 0,
  }));

  return NextResponse.json({ campaigns });
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
    description?: string;
    hypothesis?: string;
    scoreTarget?: string;
    boardKey?: string;
    trafficPercent?: number;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (!body.scoreTarget?.trim()) {
    return NextResponse.json({ error: "scoreTarget is required." }, { status: 400 });
  }

  const db = getDb();

  const [sessionRow] = await db
    .select({ hqUserId: schema.sessions.hqUserId })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  const id = nanoid(16);
  const now = new Date();

  await db.insert(schema.experimentCampaigns).values({
    id,
    name: body.name.trim(),
    description: body.description?.trim() ?? null,
    hypothesis: body.hypothesis?.trim() ?? null,
    scoreTarget: body.scoreTarget.trim(),
    boardKey: body.boardKey?.trim() ?? null,
    trafficPercent: body.trafficPercent ?? 100,
    status: "draft",
    startedAt: null,
    concludedAt: null,
    conclusion: null,
    createdByUserId: sessionRow?.hqUserId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  const [campaign] = await db
    .select()
    .from(schema.experimentCampaigns)
    .where(eq(schema.experimentCampaigns.id, id))
    .limit(1);

  return NextResponse.json({ campaign });
}
