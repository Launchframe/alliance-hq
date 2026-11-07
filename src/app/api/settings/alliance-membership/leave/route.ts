import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb, schema } from "@/lib/db";
import {
  MembershipRevokeError,
  revokeAllianceMembership,
} from "@/lib/rbac/revoke-alliance-membership.server";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;
  if (!session.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    allianceId?: string;
  } | null;
  const allianceId = body?.allianceId?.trim();
  if (!allianceId) {
    return NextResponse.json({ error: "alliance_id_required" }, { status: 400 });
  }

  const [membership] = await getDb()
    .select({ id: schema.allianceMemberships.id })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.hqUserId, session.hqUserId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (!membership) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const result = await revokeAllianceMembership({
      membershipId: membership.id,
      actorHqUserId: session.hqUserId,
      actorSessionId: session.id,
      actorSessionAllianceId: session.currentAllianceId,
      mode: "self",
    });
    return NextResponse.json({
      ok: true,
      currentAllianceId: result.currentAllianceId,
    });
  } catch (error) {
    if (error instanceof MembershipRevokeError) {
      const status = error.code === "not_found" ? 404 : 409;
      return NextResponse.json({ error: error.code }, { status });
    }
    console.error("[alliance-membership] leave failed", error);
    return NextResponse.json({ error: "leave_failed" }, { status: 500 });
  }
}
