import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { writeAuditLog } from "@/lib/bff/audit";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { getOrCreateSession } from "@/lib/session";
import {
  loadVrSandboxSettings,
  saveVrSandboxSettings,
} from "@/lib/vr/vr-sandbox.server";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  enabled: z.boolean(),
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
      "scores:read",
    );
    if (denied) return denied;

    const canManage = await sessionHasPermissionForAlliance(
      session.id,
      alliance.allianceId,
      "alliance:admin",
    );
    const settings = await loadVrSandboxSettings(
      alliance.allianceId,
      canManage,
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
      "alliance:admin",
    );
    if (denied) return denied;

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid VR sandbox settings payload." },
        { status: 400 },
      );
    }

    const before = await loadVrSandboxSettings(alliance.allianceId, true);
    const saved = await saveVrSandboxSettings(
      alliance.allianceId,
      body.data.enabled,
    );

    if (before.enabled !== saved.enabled) {
      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: saved.enabled ? "vr.sandbox_enable" : "vr.sandbox_disable",
        resourceType: "alliance",
        resourceId: alliance.allianceId,
        resourceName: alliance.name,
        metadata: {
          before: { enabled: before.enabled, seasonKey: before.seasonKey },
          after: { enabled: saved.enabled, seasonKey: saved.seasonKey },
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
