import "server-only";

import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { resolveAshedConnectionForAlliance } from "@/lib/ashed/credential-share.server";
import { canRefreshRosterFromAshed } from "@/lib/connect/ashed-shell-prompts.shared";
import type { RosterSyncCapabilityKind } from "@/lib/trains/roster-data-status.shared";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import { resolveAllianceTagForSession } from "@/lib/settings/alliance-settings-access.server";
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

  const resolved = await resolveAshedConnectionForAlliance(sessionId, allianceId);
  const connection = resolved?.connection ?? null;
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
  allianceId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof getAshedConnection>>>> {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }

  const resolved = await resolveAshedConnectionForAlliance(sessionId, allianceId);
  if (!resolved?.connection) {
    throw new Error("Not connected to Ashed.");
  }

  return resolved.connection;
}

export async function resolveOfficerAshedAllianceId(
  sessionId: string,
): Promise<{ connection: NonNullable<Awaited<ReturnType<typeof getAshedConnection>>>; ashedAllianceId: string }> {
  const session = await loadSession(sessionId);
  if (!session?.currentAllianceId) {
    throw new Error("Alliance context not set in session.");
  }

  const allianceTag = session ? await resolveAllianceTagForSession(session) : null;
  if (!allianceTag?.trim()) {
    throw new Error("Alliance tag not set in session.");
  }

  const connection = await assertOfficerAshedSessionForSync(
    sessionId,
    session.currentAllianceId,
  );
  const alliance = await resolveAllianceByTag(connection, allianceTag);
  return { connection, ashedAllianceId: alliance.id };
}
