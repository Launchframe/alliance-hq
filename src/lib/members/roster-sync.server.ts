import "server-only";

import {
  getAllianceRosterLastSyncedAt,
  listActiveAllianceMembersForPool,
  resolveHqAllianceId,
  syncAllianceMembersFromAshed,
} from "@/lib/members/roster.server";
import {
  resolveOfficerAshedAllianceId,
  resolveRosterSyncCapability,
} from "@/lib/members/roster-sync-capability.server";
import type { RosterSyncCapabilityKind } from "@/lib/trains/roster-data-status.shared";
import { getAllianceById } from "@/lib/vr/repository";
import { resolveAllianceAshedBotConnection } from "@/lib/vr/member-roster";

export class RosterSyncUnavailableError extends Error {
  readonly capability: RosterSyncCapabilityKind = "none";

  constructor(message = "Roster sync is not available for this alliance.") {
    super(message);
    this.name = "RosterSyncUnavailableError";
  }
}

export type SyncAllianceRosterResult = {
  synced: number;
  activeMemberCount: number;
  lastSyncedAt: string | null;
  capability: RosterSyncCapabilityKind;
};

export async function syncAllianceRosterForSession(input: {
  sessionId: string;
  allianceId: string;
}): Promise<SyncAllianceRosterResult> {
  const capability = await resolveRosterSyncCapability(
    input.sessionId,
    input.allianceId,
  );

  if (capability.kind === "none") {
    throw new RosterSyncUnavailableError();
  }

  let synced = 0;

  if (capability.kind === "officer_ashed") {
    const { connection, ashedAllianceId } = await resolveOfficerAshedAllianceId(
      input.sessionId,
    );
    const hqAllianceId = await resolveHqAllianceId(
      input.allianceId,
      ashedAllianceId,
    );
    const result = await syncAllianceMembersFromAshed({
      hqAllianceId,
      ashedAllianceId,
      connection,
    });
    synced = result.synced;
  } else if (capability.kind === "alliance_ashed") {
    const alliance = await getAllianceById(input.allianceId);
    if (!alliance?.ashedAllianceId) {
      throw new RosterSyncUnavailableError(
        "This alliance is not linked to Ashed.",
      );
    }
    const connection = await resolveAllianceAshedBotConnection(input.allianceId);
    if (!connection) {
      throw new RosterSyncUnavailableError();
    }
    const result = await syncAllianceMembersFromAshed({
      hqAllianceId: input.allianceId,
      ashedAllianceId: alliance.ashedAllianceId,
      connection,
    });
    synced = result.synced;
  }

  const activeMemberCount = (
    await listActiveAllianceMembersForPool(input.allianceId)
  ).length;
  const lastSyncedAt = await getAllianceRosterLastSyncedAt(input.allianceId);

  return {
    synced,
    activeMemberCount,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    capability: capability.kind,
  };
}
