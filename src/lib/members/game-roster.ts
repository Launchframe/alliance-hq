import { eq } from "drizzle-orm";

import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import {
  allianceMemberRowToAshedMember,
  listAllianceMembers,
  listActiveAllianceMembersForPool,
  listAllianceMembersWithAshedSyncIfNeeded,
} from "@/lib/members/roster.server";
import { getAllianceOperatingMode } from "@/lib/native-alliance/operating-mode";
import type { AshedMember } from "@/lib/video/member-matcher";

export type LoadAllianceGameRosterInput = {
  allianceId: string;
  connection?: ParsedConnection | null;
  ashedAllianceId?: string | null;
  /** @deprecated Use `forceRefreshFromAshed` instead. */
  syncFromAshed?: boolean;
  forceRefreshFromAshed?: boolean;
};

export async function loadAllianceGameRoster(
  input: LoadAllianceGameRosterInput,
): Promise<AshedMember[]> {
  const mode = await getAllianceOperatingMode(input.allianceId);

  if (mode === "native") {
    const rows = await listAllianceMembers(input.allianceId);
    return rows.map(allianceMemberRowToAshedMember);
  }

  const forceRefreshFromAshed = input.forceRefreshFromAshed === true;

  const rows =
    input.syncFromAshed !== false &&
    input.connection &&
    input.ashedAllianceId
      ? await listAllianceMembersWithAshedSyncIfNeeded({
          hqAllianceId: input.allianceId,
          ashedAllianceId: input.ashedAllianceId,
          connection: input.connection,
          forceRefresh: forceRefreshFromAshed,
        })
      : await listAllianceMembers(input.allianceId);

  return rows.map(allianceMemberRowToAshedMember);
}

export async function loadActiveAlliancePoolMembers(input: {
  allianceId: string;
  connection?: ParsedConnection | null;
  ashedAllianceId?: string | null;
  db?: ReturnType<typeof getDb> | import("@/lib/time-off/availability.server").AvailabilityTransaction;
}) {
  const mode = await getAllianceOperatingMode(input.allianceId, input.db);
  if (mode === "native") {
    return listActiveAllianceMembersForPool(input.allianceId, input.db);
  }

  if (input.connection && input.ashedAllianceId) {
    const { listActiveAllianceMembersForPoolWithSync } = await import(
      "@/lib/members/roster.server"
    );
    return listActiveAllianceMembersForPoolWithSync({
      hqAllianceId: input.allianceId,
      ashedAllianceId: input.ashedAllianceId,
      connection: input.connection,
    });
  }

  return listActiveAllianceMembersForPool(input.allianceId, input.db);
}

export async function loadAllianceRow(
  allianceId: string,
  db: ReturnType<typeof getDb> | import("@/lib/time-off/availability.server").AvailabilityTransaction = getDb(),
) {
  const [row] = await db
    .select()
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row ?? null;
}
