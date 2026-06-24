import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export class AllianceNotAshedLinkedError extends Error {
  readonly code = "ALLIANCE_NOT_ASHED_LINKED" as const;

  constructor(allianceId: string) {
    super(
      `Alliance ${allianceId} is not linked to Ashed. HQ cannot write Ashed entities until the alliance is connected from an existing Ashed seat.`,
    );
    this.name = "AllianceNotAshedLinkedError";
  }
}

/** Throws when the HQ alliance has no Ashed id — use before any Base44 entity POST/PUT. */
export async function assertAllianceAshedLinked(
  hqAllianceId: string,
): Promise<{ ashedAllianceId: string }> {
  const db = getDb();
  const [row] = await db
    .select({ ashedAllianceId: schema.alliances.ashedAllianceId })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, hqAllianceId))
    .limit(1);

  const ashedAllianceId = row?.ashedAllianceId?.trim();
  if (!ashedAllianceId) {
    throw new AllianceNotAshedLinkedError(hqAllianceId);
  }

  return { ashedAllianceId };
}

export async function getAshedAllianceIdIfLinked(
  hqAllianceId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ ashedAllianceId: schema.alliances.ashedAllianceId })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, hqAllianceId))
    .limit(1);

  const id = row?.ashedAllianceId?.trim();
  return id || null;
}
