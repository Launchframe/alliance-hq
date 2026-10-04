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
  revokeGuildTrainChannel,
  saveTrainDiscordSettings,
} from "@/lib/trains/train-discord-settings.server";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    announcementsEnabled: z.boolean().optional(),
    channelSetterMinRank: z.enum(["officer", "owner"]).optional(),
    clearTrainChannelForGuildId: z.string().min(1).optional(),
  })
  .refine(
    (body) =>
      body.announcementsEnabled !== undefined ||
      body.channelSetterMinRank !== undefined ||
      body.clearTrainChannelForGuildId !== undefined,
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
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
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
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid train Discord settings payload." },
        { status: 400 },
      );
    }

    const touchesAnnouncements = body.data.announcementsEnabled !== undefined;
    const touchesSetterRank = body.data.channelSetterMinRank !== undefined;
    const touchesClearChannel =
      body.data.clearTrainChannelForGuildId !== undefined;

    if (touchesAnnouncements || touchesClearChannel) {
      const denied = await requireAllianceRoutePermission(
        session.id,
        alliance.allianceId,
        "trains:write",
      );
      if (denied) return denied;
    }

    const canManage = await sessionHasPermissionForAlliance(
      session.id,
      alliance.allianceId,
      "trains:write",
    );
    const canConfigureChannelSetterMinRank = await sessionIsAllianceOwner(
      session.id,
      alliance.allianceId,
    );

    if (touchesSetterRank && !canConfigureChannelSetterMinRank) {
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
      canManage,
      canConfigureChannelSetterMinRank,
    );

    if (touchesClearChannel) {
      const { cleared, settings: saved } = await revokeGuildTrainChannel(
        alliance.allianceId,
        body.data.clearTrainChannelForGuildId!,
        canManage,
        canConfigureChannelSetterMinRank,
      );
      if (!cleared) {
        return NextResponse.json(
          { error: "Discord server is not registered for this alliance." },
          { status: 404 },
        );
      }

      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: "trains.discord_train_channel_revoke",
        resourceType: "discord_guild_alliance",
        resourceId: body.data.clearTrainChannelForGuildId,
        resourceName: alliance.name,
        metadata: {
          guildId: body.data.clearTrainChannelForGuildId,
        },
      });

      return NextResponse.json({
        allianceTag: alliance.tag,
        ...saved,
      });
    }

    const saved = await saveTrainDiscordSettings(
      alliance.allianceId,
      {
        announcementsEnabled: body.data.announcementsEnabled,
        channelSetterMinRank: body.data.channelSetterMinRank,
      },
      canConfigureChannelSetterMinRank,
      canManage,
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
