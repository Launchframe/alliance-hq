import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { writeAuditLog } from "@/lib/bff/audit";
import {
  getAllianceMembershipRbac,
  getRbacContext,
  sessionHasPermissionForAlliance,
} from "@/lib/rbac/context";
import {
  loadTrainDiscordSettings,
  saveTrainDiscordSettings,
} from "@/lib/trains/train-discord-settings.server";
import { isTrainChannelSetterMinRank } from "@/lib/trains/train-channel-setter.shared";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    announcementsEnabled: z.boolean().optional(),
    channelSetterMinRank: z.enum(["officer", "owner"]).optional(),
  })
  .refine(
    (body) =>
      body.announcementsEnabled !== undefined ||
      body.channelSetterMinRank !== undefined,
    { message: "At least one field is required." },
  );

type RouteContext = { params: Promise<{ tag: string }> };

async function sessionIsAllianceOwner(
  sessionId: string,
  allianceId: string,
): Promise<boolean> {
  const ctx = await getRbacContext(sessionId);
  if (!ctx?.hqUserId) return false;
  const membership = await getAllianceMembershipRbac(
    sessionId,
    ctx.hqUserId,
    allianceId,
  );
  return membership.roleName === "owner";
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await getOrCreateSession();
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      "scores:read",
    );
    if (denied) return denied;

    const canManage = await sessionHasPermissionForAlliance(
      session.id,
      alliance.allianceId,
      "trains:write",
    );
    const canConfigureChannelSetterMinRank = await sessionIsAllianceOwner(
      session.id,
      alliance.allianceId,
    );
    const settings = await loadTrainDiscordSettings(
      alliance.allianceId,
      canManage,
      canConfigureChannelSetterMinRank,
    );

    return NextResponse.json({
      allianceTag: alliance.tag,
      ...settings,
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await getOrCreateSession();
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      "trains:write",
    );
    if (denied) return denied;

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid train Discord settings payload." },
        { status: 400 },
      );
    }

    if (
      body.data.channelSetterMinRank !== undefined &&
      !isTrainChannelSetterMinRank(body.data.channelSetterMinRank)
    ) {
      return NextResponse.json(
        { error: "Invalid channel setter permission." },
        { status: 400 },
      );
    }

    const canConfigureChannelSetterMinRank = await sessionIsAllianceOwner(
      session.id,
      alliance.allianceId,
    );

    if (
      body.data.channelSetterMinRank !== undefined &&
      !canConfigureChannelSetterMinRank
    ) {
      return NextResponse.json(
        {
          error:
            "Only the alliance owner can change who may set the Discord train channel.",
        },
        { status: 403 },
      );
    }

    const before = await loadTrainDiscordSettings(
      alliance.allianceId,
      true,
      canConfigureChannelSetterMinRank,
    );
    const saved = await saveTrainDiscordSettings(
      alliance.allianceId,
      {
        announcementsEnabled: body.data.announcementsEnabled,
        channelSetterMinRank: body.data.channelSetterMinRank,
      },
      canConfigureChannelSetterMinRank,
    );

    const announcementsChanged =
      body.data.announcementsEnabled !== undefined &&
      before.announcementsEnabled !== saved.announcementsEnabled;
    const setterRankChanged =
      body.data.channelSetterMinRank !== undefined &&
      before.channelSetterMinRank !== saved.channelSetterMinRank;

    if (announcementsChanged || setterRankChanged) {
      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: "trains.discord_settings_update",
        resourceType: "alliance",
        resourceId: alliance.allianceId,
        resourceName: alliance.name,
        metadata: {
          before: {
            announcementsEnabled: before.announcementsEnabled,
            channelSetterMinRank: before.channelSetterMinRank,
          },
          after: {
            announcementsEnabled: saved.announcementsEnabled,
            channelSetterMinRank: saved.channelSetterMinRank,
          },
        },
      });
    }

    return NextResponse.json({
      allianceTag: alliance.tag,
      ...saved,
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}
