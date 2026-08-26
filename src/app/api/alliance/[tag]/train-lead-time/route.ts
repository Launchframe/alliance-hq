import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { writeAuditLog } from "@/lib/bff/audit";
import {
  loadAllianceTrainLeadTimeSettings,
  saveAllianceTrainLeadTimeSettings,
} from "@/lib/trains/alliance-train-lead-time.server";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  trainConductorLeadTimeDays: z.number().int().min(0).max(7),
  trainConductorConfirmationEnabled: z.boolean(),
});

type RouteContext = { params: Promise<{ tag: string }> };

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
      "alliance:admin",
    );
    const settings = await loadAllianceTrainLeadTimeSettings(
      alliance.allianceId,
      canManage,
    );

    return NextResponse.json({
      allianceTag: alliance.tag,
      allianceName: alliance.name,
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

    const denied = await requireAllianceRoutePermission(
      session.id,
      alliance.allianceId,
      "alliance:admin",
    );
    if (denied) return denied;

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid lead time settings payload." },
        { status: 400 },
      );
    }

    const before = await loadAllianceTrainLeadTimeSettings(
      alliance.allianceId,
      true,
    );
    const saved = await saveAllianceTrainLeadTimeSettings(
      alliance.allianceId,
      body.data,
    );

    if (
      before.trainConductorLeadTimeDays !== saved.trainConductorLeadTimeDays ||
      before.trainConductorConfirmationEnabled !==
        saved.trainConductorConfirmationEnabled
    ) {
      await writeAuditLog({
        sessionId: session.id,
        allianceId: alliance.allianceId,
        hqUserId: session.hqUserId ?? undefined,
        action: "trains.alliance_train_lead_time_update",
        resourceType: "alliance",
        resourceId: alliance.allianceId,
        resourceName: alliance.name,
        metadata: {
          before: {
            trainConductorLeadTimeDays: before.trainConductorLeadTimeDays,
            trainConductorConfirmationEnabled:
              before.trainConductorConfirmationEnabled,
          },
          after: {
            trainConductorLeadTimeDays: saved.trainConductorLeadTimeDays,
            trainConductorConfirmationEnabled:
              saved.trainConductorConfirmationEnabled,
          },
        },
      });
    }

    return NextResponse.json({
      allianceTag: alliance.tag,
      allianceName: alliance.name,
      ...saved,
      canManage: true,
    });
  } catch (error) {
    return allianceRouteErrorResponse(error);
  }
}
