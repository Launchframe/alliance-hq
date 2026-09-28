import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import {
  resolveAllianceSettingsAccess,
} from "@/lib/settings/alliance-settings-access.server";
import { getAshedConnection, loadSession, readSessionId } from "@/lib/session";
import { requireAllianceAdmin } from "@/lib/rbac/require-permission";
import {
  RosterSyncUnavailableError,
  syncAllianceRosterForSession,
} from "@/lib/members/roster-sync.server";
import {
  getAllianceTeam,
  syncAshedAllianceRoles,
} from "@/lib/rbac/sync-ashed-roles";

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

  const allianceId = resolveSessionAllianceId(access.session);
  if (!allianceId) {
    return NextResponse.json(
      { error: "Alliance context required. Select an alliance from the sidebar." },
      { status: 400 },
    );
  }

  const team = await getAllianceTeam(allianceId);
  return NextResponse.json({ team });
}

export async function POST() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requireAllianceAdmin(sessionId);
  if (denied) return denied;

  const session = await loadSession(sessionId);
  const connection = await getAshedConnection(sessionId);
  if (!session?.allianceTag || !connection) {
    return NextResponse.json(
      { error: "Reconnect with a valid Ashed token." },
      { status: 400 },
    );
  }

  const meResponse = await fetch(
    `https://base44.app/api/apps/${connection.appId}/entities/User/me`,
    {
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "X-Origin-Url": connection.originUrl,
      },
    },
  );
  if (!meResponse.ok) {
    return NextResponse.json(
      { error: "Failed to refresh from Ashed." },
      { status: 502 },
    );
  }
  const me = (await meResponse.json()) as {
    id?: string;
    email?: string;
    full_name?: string;
  };

  if (!me.email) {
    return NextResponse.json(
      { error: "Ashed user email missing." },
      { status: 502 },
    );
  }

  await syncAshedAllianceRoles({
    connection,
    sessionId,
    allianceTag: session.allianceTag,
    authHqUserId: session.hqUserId,
    preferHqAllianceId: session.currentAllianceId,
    currentUser: {
      id: me.id,
      email: me.email,
      full_name: me.full_name,
    },
  });

  const refreshed = await loadSession(sessionId);
  const allianceId = refreshed
    ? resolveSessionAllianceId(refreshed)
    : null;

  // In-game ranks (and R4 privilege nudges) come from the roster, not the
  // collaborator role sync above.
  let rosterSynced = false;
  if (allianceId) {
    try {
      await syncAllianceRosterForSession({ sessionId, allianceId });
      rosterSynced = true;
    } catch (error) {
      if (!(error instanceof RosterSyncUnavailableError)) {
        console.error("[settings/team] roster sync failed", {
          allianceId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const team = allianceId ? await getAllianceTeam(allianceId) : [];

  return NextResponse.json({ ok: true, team, rosterSynced });
}
