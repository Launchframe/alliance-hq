import "server-only";

import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { canRefreshRosterFromAshed } from "@/lib/connect/ashed-shell-prompts.shared";
import type { RosterSyncCapabilityKind } from "@/lib/trains/roster-data-status.shared";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { getAshedConnection, loadSession } from "@/lib/session";
import { getAllianceById } from "@/lib/vr/repository";
import { resolveAllianceAshedBotConnection } from "@/lib/vr/member-roster";

export type ResolvedRosterSyncCapability = {
  kind: RosterSyncCapabilityKind;
};

export async function resolveRosterSyncCapability(
  sessionId: string,
  allianceId: string,
): Promise<ResolvedRosterSyncCapability> {
  const operatingMode = await getAllianceOperatingMode(allianceId);

  if (operatingMode === "native") {
    return { kind: "native_reload" };
  }

  const alliance = await getAllianceById(allianceId);
  if (
    alliance?.ashedAllianceId &&
    (await resolveAllianceAshedBotConnection(allianceId))
  ) {
    return { kind: "alliance_ashed" };
  }

  const connection = await getAshedConnection(sessionId);
  if (
    canRefreshRosterFromAshed({
      operatingMode,
      isAshedConnected: connection !== null,
    })
  ) {
    return { kind: "officer_ashed" };
  }

  return { kind: "none" };
}

export async function assertOfficerAshedSessionForSync(
  sessionId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof getAshedConnection>>>> {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }
  if (!session.allianceTag?.trim()) {
    throw new Error("Alliance tag not set in session.");
  }

  const connection = await getAshedConnection(sessionId);
  if (!connection) {
    throw new Error("Not connected to Ashed.");
  }

  return connection;
}

export async function resolveOfficerAshedAllianceId(
  sessionId: string,
): Promise<{ connection: NonNullable<Awaited<ReturnType<typeof getAshedConnection>>>; ashedAllianceId: string }> {
  const session = await loadSession(sessionId);
  if (!session?.allianceTag?.trim()) {
    throw new Error("Alliance tag not set in session.");
  }

  const connection = await assertOfficerAshedSessionForSync(sessionId);
  const alliance = await resolveAllianceByTag(connection, session.allianceTag);
  return { connection, ashedAllianceId: alliance.id };
}
