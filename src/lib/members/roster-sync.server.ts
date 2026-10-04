import "server-only";

import {
  getAllianceRosterLastSyncedAt,
  listActiveAllianceMembersForPool,
  resolveHqAllianceId,
  syncAllianceMembersFromAshed,
} from "@/lib/members/roster.server";
import {
  requireActiveShareCapability,
  resolveAshedConnectionForAlliance,
} from "@/lib/ashed/credential-share.server";
import {
  assertOfficerAshedSessionForSync,
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

async function syncViaAllianceBotCredentials(
  allianceId: string,
): Promise<{ synced: number } | null> {
  const alliance = await getAllianceById(allianceId);
  if (!alliance?.ashedAllianceId) {
    return null;
  }
  const connection = await resolveAllianceAshedBotConnection(allianceId);
  if (!connection) {
    return null;
  }
  return syncAllianceMembersFromAshed({
    hqAllianceId: allianceId,
    ashedAllianceId: alliance.ashedAllianceId,
    connection,
  });
}

async function resolveAshedAllianceIdForOfficerSync(input: {
  sessionId: string;
  hqAllianceId: string;
}): Promise<string> {
  const alliance = await getAllianceById(input.hqAllianceId);
  const linkedAshedAllianceId = alliance?.ashedAllianceId?.trim();
  if (linkedAshedAllianceId) {
    return linkedAshedAllianceId;
  }

  return (await resolveOfficerAshedAllianceId(input.sessionId)).ashedAllianceId;
}

export async function syncAllianceRosterForSession(input: {
  sessionId: string;
  allianceId: string;
}): Promise<SyncAllianceRosterResult> {
  let capability = await resolveRosterSyncCapability(
    input.sessionId,
    input.allianceId,
  );

  if (capability.kind === "none") {
    throw new RosterSyncUnavailableError();
  }

  let synced = 0;

  if (capability.kind === "officer_ashed") {
    const resolved = await resolveAshedConnectionForAlliance(
      input.sessionId,
      input.allianceId,
    );
    if (resolved?.isDelegated) {
      await requireActiveShareCapability({
        sessionId: input.sessionId,
        allianceId: input.allianceId,
        capability: "roster:sync",
        delegatedAction: "roster.sync",
      });
    }

    const connection = await assertOfficerAshedSessionForSync(
      input.sessionId,
      input.allianceId,
    );
    const ashedAllianceId = await resolveAshedAllianceIdForOfficerSync({
      sessionId: input.sessionId,
      hqAllianceId: input.allianceId,
    });
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

    if (synced === 0) {
      const botResult = await syncViaAllianceBotCredentials(input.allianceId);
      if (botResult) {
        synced = botResult.synced;
        capability = { kind: "alliance_ashed" };
      }
    }
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
