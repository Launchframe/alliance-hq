import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";
import { buildExperimentDetailAnalytics } from "@/lib/video/experiment-detail-analytics";

type RouteParams = { params: Promise<{ campaignId: string }> };

const CAMPAIGN_STATUSES = new Set(["draft", "active", "paused", "concluded"]);

function validTrafficPercent(value: number | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 100
  );
}

export async function GET(_request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { campaignId } = await params;
  const db = getDb();

  const [campaign] = await db
    .select()
    .from(schema.experimentCampaigns)
    .where(eq(schema.experimentCampaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const armsWithConfigs = await db
    .select({
      id: schema.experimentArms.id,
      campaignId: schema.experimentArms.campaignId,
      name: schema.experimentArms.name,
      isControl: schema.experimentArms.isControl,
      configId: schema.experimentArms.configId,
      trafficWeight: schema.experimentArms.trafficWeight,
      createdAt: schema.experimentArms.createdAt,
      configName: schema.parseConfigs.name,
      configPassKey: schema.parseConfigs.passKey,
    })
    .from(schema.experimentArms)
    .leftJoin(
      schema.parseConfigs,
      eq(schema.experimentArms.configId, schema.parseConfigs.id),
    )
    .where(eq(schema.experimentArms.campaignId, campaignId));

  const arms = armsWithConfigs.map(({ configName, configPassKey, ...arm }) => ({
    ...arm,
    config:
      configName != null && configPassKey != null
        ? { name: configName, passKey: configPassKey }
        : null,
  }));

  const groups = await db
    .select({
      id: schema.videoUploadGroups.id,
      experimentArmId: schema.videoUploadGroups.experimentArmId,
      scoreTarget: schema.videoUploadGroups.scoreTarget,
      boardKey: schema.videoUploadGroups.boardKey,
      hqEventId: schema.videoUploadGroups.hqEventId,
    })
    .from(schema.videoUploadGroups)
    .where(eq(schema.videoUploadGroups.experimentCampaignId, campaignId));

  const groupIds = groups.map((group) => group.id);
  const jobs =
    groupIds.length > 0
      ? await db
          .select({
            id: schema.videoJobs.id,
            groupId: schema.videoJobs.groupId,
            passRole: schema.videoJobs.passRole,
            passKey: schema.videoJobs.passKey,
            rating: schema.videoJobs.rating,
            qualityScore: schema.videoJobs.qualityScore,
            qualityBucket: schema.videoJobs.qualityBucket,
            createdAt: schema.videoJobs.createdAt,
          })
          .from(schema.videoJobs)
          .where(inArray(schema.videoJobs.groupId, groupIds))
      : [];

  const analytics = buildExperimentDetailAnalytics({ arms, groups, jobs });

  return NextResponse.json({
    campaign,
    arms: analytics.arms,
    dailySeries: analytics.dailySeries,
    population: analytics.population,
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { campaignId } = await params;
  const db = getDb();

  const [existing] = await db
    .select()
    .from(schema.experimentCampaigns)
    .where(eq(schema.experimentCampaigns.id, campaignId))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    name?: string;
    description?: string;
    hypothesis?: string;
    boardKey?: string;
    trafficPercent?: number;
    status?: string;
    conclusion?: string;
  };

  const newStatus = body.status;
  const now = new Date();

  if (newStatus !== undefined && !CAMPAIGN_STATUSES.has(newStatus)) {
    return NextResponse.json(
      { error: "status must be draft, active, paused, or concluded." },
      { status: 400 },
    );
  }
  if (
    body.trafficPercent !== undefined &&
    !validTrafficPercent(body.trafficPercent)
  ) {
    return NextResponse.json(
      { error: "trafficPercent must be an integer from 1 to 100." },
      { status: 400 },
    );
  }

  // Validate status transitions
  if (newStatus !== undefined && newStatus !== existing.status) {
    if (existing.status === "concluded") {
      return NextResponse.json(
        { error: "Cannot change status from concluded." },
        { status: 400 },
      );
    }

    if (newStatus === "concluded") {
      if (!body.conclusion?.trim()) {
        return NextResponse.json(
          { error: "conclusion is required when concluding a campaign." },
          { status: 400 },
        );
      }
    }

    if (
      (newStatus === "active" && (existing.status === "draft" || existing.status === "paused"))
    ) {
      // Validate at least 2 arms with one control
      const arms = await db
        .select()
        .from(schema.experimentArms)
        .where(eq(schema.experimentArms.campaignId, campaignId));

      if (arms.length < 2) {
        return NextResponse.json(
          { error: "Campaign must have at least 2 arms to activate." },
          { status: 400 },
        );
      }

      const controlArm = arms.find((a) => a.isControl);
      if (!controlArm) {
        return NextResponse.json(
          { error: "Campaign must have at least one control arm to activate." },
          { status: 400 },
        );
      }

      // Check for conflicting active campaign
      const scoreTarget = existing.scoreTarget;
      const boardKey = existing.boardKey;

      const conflictConditions = boardKey
        ? and(
            eq(schema.experimentCampaigns.status, "active"),
            eq(schema.experimentCampaigns.scoreTarget, scoreTarget),
            eq(schema.experimentCampaigns.boardKey, boardKey),
            ne(schema.experimentCampaigns.id, campaignId),
          )
        : and(
            eq(schema.experimentCampaigns.status, "active"),
            eq(schema.experimentCampaigns.scoreTarget, scoreTarget),
            isNull(schema.experimentCampaigns.boardKey),
            ne(schema.experimentCampaigns.id, campaignId),
          );

      const [conflict] = await db
        .select({ id: schema.experimentCampaigns.id })
        .from(schema.experimentCampaigns)
        .where(conflictConditions)
        .limit(1);

      if (conflict) {
        return NextResponse.json(
          { error: "Another active campaign exists for this scope." },
          { status: 409 },
        );
      }
    }
  }

  const updates: Record<string, unknown> = { updatedAt: now };

  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.description !== undefined) updates.description = body.description.trim() || null;
  if (body.hypothesis !== undefined) updates.hypothesis = body.hypothesis.trim() || null;
  if (body.boardKey !== undefined) updates.boardKey = body.boardKey.trim() || null;
  if (body.trafficPercent !== undefined) updates.trafficPercent = body.trafficPercent;

  if (newStatus !== undefined) {
    updates.status = newStatus;
    if (newStatus === "active" && existing.status !== "active") {
      updates.startedAt = now;
    }
    if (newStatus === "concluded") {
      updates.concludedAt = now;
      updates.conclusion = body.conclusion?.trim() ?? null;
    }
  }

  await db
    .update(schema.experimentCampaigns)
    .set(updates)
    .where(eq(schema.experimentCampaigns.id, campaignId));

  const [campaign] = await db
    .select()
    .from(schema.experimentCampaigns)
    .where(eq(schema.experimentCampaigns.id, campaignId))
    .limit(1);

  return NextResponse.json({ campaign });
}
