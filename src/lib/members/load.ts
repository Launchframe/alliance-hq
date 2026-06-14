import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { base44ListMembers } from "@/lib/base44/fetch";
import { getAshedConnection, loadSession } from "@/lib/session";
import type { AshedMember } from "@/lib/video/member-matcher";

export type AllianceMembersPayload = {
  alliance: {
    id: string;
    tag: string;
    name?: string;
  };
  members: AshedMember[];
  counts: {
    total: number;
    active: number;
    former: number;
  };
  fetchedAt: string;
};

function sortMembers(members: AshedMember[]): AshedMember[] {
  return [...members].sort((a, b) =>
    a.current_name.localeCompare(b.current_name, undefined, {
      sensitivity: "base",
    }),
  );
}

export async function loadAllianceMembers(
  sessionId: string,
): Promise<AllianceMembersPayload> {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }

  const connection = await getAshedConnection(sessionId);
  if (!connection) {
    throw new Error("Not connected to Ashed.");
  }

  if (!session.allianceTag) {
    throw new Error(
      "Alliance tag not set. Add your tag in Settings before viewing members.",
    );
  }

  const alliance = await resolveAllianceByTag(connection, session.allianceTag);
  const members = sortMembers(
    await base44ListMembers(connection, alliance.id),
  );

  const active = members.filter((m) => m.status !== "former").length;

  return {
    alliance,
    members,
    counts: {
      total: members.length,
      active,
      former: members.length - active,
    },
    fetchedAt: new Date().toISOString(),
  };
}
