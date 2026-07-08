import { eq } from "drizzle-orm";

import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { getDb, schema } from "@/lib/db";
import { loadAllianceGameRoster } from "@/lib/members/game-roster";
import { listCommanderIdentityConflictsForAlliance } from "@/lib/members/commander-identity.server";
import type { CommanderIdentityConflict } from "@/lib/members/commander-identity-conflicts.shared";
import { searchAllianceMembers } from "@/lib/members/members-search.server";
import {
  getAllianceRosterLastSyncedAt,
  resolveHqAllianceId,
} from "@/lib/members/roster.server";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
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
  operatingMode: "ashed" | "native";
  commanderConflicts: CommanderIdentityConflict[];
  gameServerNumber?: number | null;
};

function sortMembers(members: AshedMember[]): AshedMember[] {
  return [...members].sort((a, b) =>
    a.current_name.localeCompare(b.current_name, undefined, {
      sensitivity: "base",
    }),
  );
}

function countMembers(members: AshedMember[]): AllianceMembersPayload["counts"] {
  const active = members.filter((m) => m.status !== "former").length;
  return {
    total: members.length,
    active,
    former: members.length - active,
  };
}

async function enrichMembersPayload(
  payload: Omit<
    AllianceMembersPayload,
    "commanderConflicts" | "gameServerNumber"
  >,
  allianceId: string,
): Promise<AllianceMembersPayload> {
  const db = getDb();
  const [allianceRow] = await db
    .select({ gameServerNumber: schema.alliances.gameServerNumber })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return {
    ...payload,
    gameServerNumber: allianceRow?.gameServerNumber ?? null,
    commanderConflicts:
      await listCommanderIdentityConflictsForAlliance(allianceId),
  };
}

async function rosterFetchedAtIso(hqAllianceId: string): Promise<string> {
  const lastSyncedAt = await getAllianceRosterLastSyncedAt(hqAllianceId);
  return (lastSyncedAt ?? new Date()).toISOString();
}

async function loadLocalMembersPayload(
  hqAllianceId: string,
  allianceRow: { tag: string; name: string | null },
  operatingMode: "ashed" | "native",
): Promise<AllianceMembersPayload> {
  const members = sortMembers(
    await loadAllianceGameRoster({
      allianceId: hqAllianceId,
      syncFromAshed: false,
    }),
  );
  const active = members.filter((m) => m.status !== "former").length;

  return enrichMembersPayload(
    {
      alliance: {
        id: hqAllianceId,
        tag: allianceRow.tag.trim(),
        name: allianceRow.name ?? undefined,
      },
      members,
      counts: {
        total: members.length,
        active,
        former: members.length - active,
      },
      fetchedAt: await rosterFetchedAtIso(hqAllianceId),
      operatingMode,
    },
    hqAllianceId,
  );
}

export async function loadAllianceMembers(
  sessionId: string,
  options?: {
    q?: string;
    includeFormer?: boolean;
    /** Pull a fresh roster from Ashed instead of using cached rows only. */
    refresh?: boolean;
  },
): Promise<AllianceMembersPayload> {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }

  const hqAllianceId = session.currentAllianceId ?? session.allianceId;
  if (!hqAllianceId) {
    throw new Error(
      "No alliance selected. Accept your invite or connect from Settings.",
    );
  }

  const db = getDb();
  const [allianceRow] = await db
    .select()
    .from(schema.alliances)
    .where(eq(schema.alliances.id, hqAllianceId))
    .limit(1);

  if (!allianceRow?.tag?.trim()) {
    throw new Error(
      "Alliance tag not set. Add your tag in Settings before viewing members.",
    );
  }

  const operatingMode = await getAllianceOperatingMode(hqAllianceId);

  if (operatingMode === "native") {
    const payload = await loadLocalMembersPayload(
      hqAllianceId,
      { tag: allianceRow.tag.trim(), name: allianceRow.name },
      operatingMode,
    );
    if (options?.q?.trim()) {
      payload.members = await searchAllianceMembers({
        allianceId: hqAllianceId,
        q: options.q,
        includeFormer: options.includeFormer ?? false,
      });
      payload.counts = countMembers(payload.members);
    } else if (options?.includeFormer === false) {
      payload.members = payload.members.filter((m) => m.status !== "former");
      payload.counts = countMembers(payload.members);
    }
    return payload;
  }

  const connection = await getAshedConnection(sessionId);
  if (!connection) {
    // HQ members without a personal Ashed credential still read the locally synced roster.
    const payload = await loadLocalMembersPayload(
      hqAllianceId,
      { tag: allianceRow.tag.trim(), name: allianceRow.name },
      operatingMode,
    );
    if (options?.q?.trim()) {
      payload.members = await searchAllianceMembers({
        allianceId: hqAllianceId,
        q: options.q,
        includeFormer: options.includeFormer ?? false,
      });
      payload.counts = countMembers(payload.members);
    } else if (options?.includeFormer === false) {
      payload.members = payload.members.filter((m) => m.status !== "former");
      payload.counts = countMembers(payload.members);
    }
    return payload;
  }

  if (!session.allianceTag) {
    throw new Error(
      "Alliance tag not set. Add your tag in Settings before viewing members.",
    );
  }

  const alliance = await resolveAllianceByTag(connection, session.allianceTag);
  const resolvedHqAllianceId = await resolveHqAllianceId(
    session.currentAllianceId ?? session.allianceId,
    alliance.id,
  );

  const members = sortMembers(
    await loadAllianceGameRoster({
      allianceId: resolvedHqAllianceId,
      connection,
      ashedAllianceId: alliance.id,
      forceRefreshFromAshed: options?.refresh === true,
    }),
  );

  const active = members.filter((m) => m.status !== "former").length;

  const payload = await enrichMembersPayload(
    {
      alliance,
      members,
      counts: {
        total: members.length,
        active,
        former: members.length - active,
      },
      fetchedAt: await rosterFetchedAtIso(resolvedHqAllianceId),
      operatingMode,
    },
    resolvedHqAllianceId,
  );

  if (options?.q?.trim()) {
    payload.members = await searchAllianceMembers({
      allianceId: resolvedHqAllianceId,
      q: options.q,
      includeFormer: options.includeFormer ?? false,
    });
    payload.counts = countMembers(payload.members);
  } else if (options?.includeFormer === false) {
    payload.members = payload.members.filter((m) => m.status !== "former");
    payload.counts = countMembers(payload.members);
  }

  return payload;
}
