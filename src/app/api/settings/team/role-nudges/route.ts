import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import {
  listOpenMemberRoleNudges,
  listTeamRoleHistory,
} from "@/lib/member-role-nudges/actions.server";
import { getRbacContext } from "@/lib/rbac/context";
import { ALLIANCE_ADMIN_PERMISSION } from "@/lib/rbac/constants";
import { resolveAllianceSettingsAccess } from "@/lib/settings/alliance-settings-access.server";
import { loadSession, readSessionId } from "@/lib/session";

function canViewRoleNudges(
  rbac: NonNullable<Awaited<ReturnType<typeof getRbacContext>>>,
): boolean {
  if (rbac.isPlatformMaintainer) return true;
  if (rbac.permissions.has(ALLIANCE_ADMIN_PERMISSION)) return true;
  return (
    rbac.roleName === "owner" ||
    rbac.roleName === "maintainer" ||
    rbac.roleName === "officer"
  );
}

export async function GET() {
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
  if (!rbac || !canViewRoleNudges(rbac)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allianceId = resolveSessionAllianceId(access.session);
  if (!allianceId) {
    return NextResponse.json(
      { error: "Alliance context required." },
      { status: 400 },
    );
  }

  const [open, history] = await Promise.all([
    listOpenMemberRoleNudges(allianceId),
    listTeamRoleHistory(allianceId, 40),
  ]);

  return NextResponse.json({ open, history });
}
