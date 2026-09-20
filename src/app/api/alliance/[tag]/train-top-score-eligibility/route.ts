import { NextResponse } from "next/server";
import { z } from "zod";

import {
  allianceRouteErrorResponse,
  requireAllianceRoutePermission,
  resolveAllianceRouteForSession,
} from "@/lib/alliance/alliance-route-context.server";
import { writeAuditLog } from "@/lib/bff/audit";
import {
  loadTrainTopScoreEligibility,
  saveTrainTopScoreEligibility,
} from "@/lib/trains/train-top-score-eligibility.server";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    trainTopScoreMinRank: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
    trainTopScoreIncludesR4Plus: z.boolean(),
  })
  .strict();

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
      "trains:write",
    );
    const settings = await loadTrainTopScoreEligibility(
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
      "trains:write",
    );
    if (denied) return denied;

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: "Could not save top score train eligibility." },
        { status: 400 },
      );
    }

    const before = await loadTrainTopScoreEligibility(
      alliance.allianceId,
      true,
    );
    const saved = await saveTrainTopScoreEligibility(
      alliance.allianceId,
      body.data,
    );

    const changed =
      before.trainTopScoreMinRank !== saved.trainTopScoreMinRank ||
      before.trainTopScoreIncludesR4Plus !==
      saved.trainTopScoreIncludesR4Plus;

    if (!changed) {
      return NextResponse.json({
        allianceTag: alliance.tag,
        allianceName: alliance.name,
        ...saved,
        canManage: true,
        unchanged: true,
      });
    }

    await writeAuditLog({
      sessionId: session.id,
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId ?? undefined,
      action: "trains.top_score_eligibility_update",
      resourceType: "alliance",
      resourceId: alliance.allianceId,
      resourceName: alliance.name,
      severity: "update",
      metadata: {
        before: {
          trainTopScoreMinRank: before.trainTopScoreMinRank,
          trainTopScoreIncludesR4Plus: before.trainTopScoreIncludesR4Plus,
        },
        after: {
          trainTopScoreMinRank: saved.trainTopScoreMinRank,
          trainTopScoreIncludesR4Plus: saved.trainTopScoreIncludesR4Plus,
        },
      },
    });

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
