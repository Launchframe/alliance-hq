import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import {
  loadMemberOnboardingSettings,
  saveMemberOnboardingSettings,
} from "@/lib/member-link/self-service-onboarding.server";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  selfServiceOnboardingEnabled: z.boolean().optional(),
  inviteOnboardingMinRole: z.enum(["officer", "owner"]).optional(),
});

type RouteContext = { params: Promise<{ tag: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await getOrCreateSession();
    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      "alliance:admin",
    );
    if (denied) return denied;

    const settings = await loadMemberOnboardingSettings({
      allianceId: alliance.allianceId,
      sessionId: session.id,
      hqUserId: session.hqUserId ?? null,
    });
    if (!settings) {
      return NextResponse.json({ error: "Alliance not found." }, { status: 404 });
    }

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
    if (!session.hqUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { tag } = await context.params;
    const alliance = await resolveAllianceRouteForSession(session.id, tag);

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      "alliance:admin",
    );
    if (denied) return denied;

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid member onboarding settings payload." },
        { status: 400 },
      );
    }

    const current = await loadMemberOnboardingSettings({
      allianceId: alliance.allianceId,
      sessionId: session.id,
      hqUserId: session.hqUserId,
    });
    if (!current?.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const saved = await saveMemberOnboardingSettings({
      allianceId: alliance.allianceId,
      ownerHqUserId: session.hqUserId,
      ...(body.data.selfServiceOnboardingEnabled !== undefined
        ? { selfServiceOnboardingEnabled: body.data.selfServiceOnboardingEnabled }
        : {}),
      ...(body.data.inviteOnboardingMinRole !== undefined
        ? { inviteOnboardingMinRole: body.data.inviteOnboardingMinRole }
        : {}),
    });

    if (!saved) {
      return NextResponse.json({ error: "Could not save settings." }, { status: 400 });
    }

    const viewerSettings = await loadMemberOnboardingSettings({
      allianceId: alliance.allianceId,
      sessionId: session.id,
      hqUserId: session.hqUserId,
    });

    return NextResponse.json({
      allianceTag: alliance.tag,
      ...(viewerSettings ?? saved),
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}
