import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { ExtractionConfig } from "@/lib/db/schema";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

type RouteParams = { params: Promise<{ configId: string }> };

const CONFIG_STATUSES = new Set(["draft", "active", "archived"]);

function isValidExtractionConfig(config: ExtractionConfig): boolean {
  if (config.mode === "scene") {
    return (
      typeof config.sceneThreshold === "number" &&
      config.sceneThreshold > 0 &&
      config.sceneThreshold <= 1 &&
      (config.sampleFps === undefined ||
        (typeof config.sampleFps === "number" && config.sampleFps > 0))
    );
  }

  return (
    config.mode === "fps" &&
    typeof config.sampleFps === "number" &&
    config.sampleFps > 0
  );
}

export async function GET(_request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { configId } = await params;
  const db = getDb();

  const [config] = await db
    .select()
    .from(schema.parseConfigs)
    .where(eq(schema.parseConfigs.id, configId))
    .limit(1);

  if (!config) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

  return NextResponse.json({ config });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { configId } = await params;
  const db = getDb();

  const [existing] = await db
    .select()
    .from(schema.parseConfigs)
    .where(eq(schema.parseConfigs.id, configId))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Config not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    name?: string;
    passKey?: string;
    description?: string;
    status?: string;
    notes?: string;
    configJson?: ExtractionConfig;
  };

  // Validate status transitions
  if (body.status !== undefined) {
    if (!CONFIG_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: "status must be draft, active, or archived." },
        { status: 400 },
      );
    }

    if (existing.status === "archived" && body.status === "active") {
      return NextResponse.json(
        { error: "Cannot move from archived to active directly. Transition to draft first." },
        { status: 400 },
      );
    }

    // Block archiving if referenced by an active campaign arm
    if (body.status === "archived" && existing.status !== "archived") {
      const activeRefs = await db
        .select({ armId: schema.experimentArms.id })
        .from(schema.experimentArms)
        .innerJoin(
          schema.experimentCampaigns,
          eq(schema.experimentArms.campaignId, schema.experimentCampaigns.id),
        )
        .where(
          and(
            eq(schema.experimentArms.configId, configId),
            eq(schema.experimentCampaigns.status, "active"),
          ),
        )
        .limit(1);

      if (activeRefs.length > 0) {
        return NextResponse.json(
          { error: "Cannot archive: config is referenced by an active experiment arm." },
          { status: 409 },
        );
      }
    }
  }

  if (
    body.configJson !== undefined &&
    !isValidExtractionConfig(body.configJson)
  ) {
    return NextResponse.json(
      { error: "configJson must include valid mode and sampling values." },
      { status: 400 },
    );
  }

  const now = new Date();
  await db
    .update(schema.parseConfigs)
    .set({
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.passKey !== undefined ? { passKey: body.passKey.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.notes !== undefined ? { notes: body.notes.trim() || null } : {}),
      ...(body.configJson !== undefined ? { configJson: body.configJson } : {}),
      updatedAt: now,
    })
    .where(eq(schema.parseConfigs.id, configId));

  const [config] = await db
    .select()
    .from(schema.parseConfigs)
    .where(eq(schema.parseConfigs.id, configId))
    .limit(1);

  return NextResponse.json({ config });
}
