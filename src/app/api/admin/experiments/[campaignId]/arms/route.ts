import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

type RouteParams = { params: Promise<{ campaignId: string }> };

function validTrafficWeight(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export async function POST(request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { campaignId } = await params;
  const db = getDb();

  const [campaign] = await db
    .select({ id: schema.experimentCampaigns.id })
    .from(schema.experimentCampaigns)
    .where(eq(schema.experimentCampaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    name?: string;
    isControl?: boolean;
    configId?: string;
    trafficWeight?: number;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  if (
    body.trafficWeight !== undefined &&
    !validTrafficWeight(body.trafficWeight)
  ) {
    return NextResponse.json(
      { error: "trafficWeight must be a positive integer." },
      { status: 400 },
    );
  }

  if (body.isControl) {
    const [existingControl] = await db
      .select({ id: schema.experimentArms.id })
      .from(schema.experimentArms)
      .where(
        and(
          eq(schema.experimentArms.campaignId, campaignId),
          eq(schema.experimentArms.isControl, true),
        ),
      )
      .limit(1);

    if (existingControl) {
      return NextResponse.json(
        { error: "A control arm already exists for this campaign." },
        { status: 409 },
      );
    }
  }

  const id = nanoid(16);
  const now = new Date();

  await db.insert(schema.experimentArms).values({
    id,
    campaignId,
    name: body.name.trim(),
    isControl: body.isControl ?? false,
    configId: body.configId ?? null,
    trafficWeight: body.trafficWeight ?? 50,
    createdAt: now,
  });

  const [arm] = await db
    .select()
    .from(schema.experimentArms)
    .where(eq(schema.experimentArms.id, id))
    .limit(1);

  return NextResponse.json({ arm });
}
