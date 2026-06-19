import { eq } from "drizzle-orm";

import { resolveAllianceByTag } from "@/lib/alliance/resolve";
import { getDb, schema } from "@/lib/db";
import { loadAllianceGameRoster } from "@/lib/members/game-roster";
import {
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
    const members = sortMembers(
      await loadAllianceGameRoster({
        allianceId: hqAllianceId,
        syncFromAshed: false,
      }),
    );
    const active = members.filter((m) => m.status !== "former").length;

    return {
      alliance: {
        id: hqAllianceId,
        tag: allianceRow.tag.trim(),
        name: allianceRow.name,
      },
      members,
      counts: {
        total: members.length,
        active,
        former: members.length - active,
      },
      fetchedAt: new Date().toISOString(),
      operatingMode,
    };
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
  const resolvedHqAllianceId = await resolveHqAllianceId(
    session.currentAllianceId ?? session.allianceId,
    alliance.id,
  );

  const members = sortMembers(
    await loadAllianceGameRoster({
      allianceId: resolvedHqAllianceId,
      connection,
      ashedAllianceId: alliance.id,
    }),
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
    operatingMode,
  };
}
