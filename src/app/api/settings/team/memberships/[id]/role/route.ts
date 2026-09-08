import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { getRbacContext } from "@/lib/rbac/context";
import { resolveAllianceSettingsAccess } from "@/lib/settings/alliance-settings-access.server";
import { canRevokeOfficerAccess } from "@/lib/settings/team-officer-revoke.shared";
import {
  TeamOfficerRevokeError,
  revokeOfficerMembershipToMember,
} from "@/lib/settings/team-officer-revoke.server";
import { loadSession, readSessionId } from "@/lib/session";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await loadSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await resolveAllianceSettingsAccess(session);
  if (access.kind !== "ready") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rbac = await getRbacContext(sessionId);
  if (!rbac || !canRevokeOfficerAccess(rbac)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allianceId = resolveSessionAllianceId(access.session);
  if (!allianceId) {
    return NextResponse.json(
      { error: "Alliance context required." },
      { status: 400 },
    );
  }

  const { id: membershipId } = await context.params;
  let body: { roleName?: string } = {};
  try {
    body = (await request.json()) as { roleName?: string };
  } catch {
    body = {};
  }

  if (body.roleName !== "member") {
    return NextResponse.json(
      { error: "Only demotion to member is supported.", code: "INVALID" },
      { status: 400 },
    );
  }

  try {
    const result = await revokeOfficerMembershipToMember({
      allianceId,
      membershipId,
      actorHqUserId: rbac.hqUserId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TeamOfficerRevokeError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "LAST_OFFICER" || error.code === "SELF"
              ? 409
              : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    throw error;
  }
}
