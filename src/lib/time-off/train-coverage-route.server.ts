import "server-only";

import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { requireApiSession } from "@/lib/session";
import { requireTrainOfficer } from "@/lib/rbac/require-permission";
import { resolveTrainRequestContext } from "@/lib/trains/api-context";
import { CoverageConflictError, withCoverageActor, type CoverageActor } from "./coverage.server";

export function withTrainCoverage(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    const denied = await requireTrainOfficer(session.id);
    if (denied) return denied;
    const context = await resolveTrainRequestContext();
    if (context instanceof NextResponse) return context;
    const body = await request.clone().json().catch(() => ({}));
    const actor: CoverageActor = { allianceId: context.allianceId, hqUserId: session.hqUserId, acceptance: body.coverage };
    return withCoverageActor(actor, async () => {
      let response: Response;
      try { response = await handler(request); }
      catch (error) {
        if (!(error instanceof CoverageConflictError)) throw error;
        actor.conflict = error;
        response = new Response(null, { status: 409 });
      }
      if (!actor.conflict) return response;
      const t = await getTranslations("teamWork");
      return NextResponse.json({ code: "coverage_conflict", error: t("keepHint"), conflicts: actor.conflict.conflicts }, { status: 409 });
    });
  };
}
