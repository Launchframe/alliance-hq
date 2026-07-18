import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export class AllianceNotAshedLinkedError extends Error {
  readonly code = "ALLIANCE_NOT_ASHED_LINKED" as const;
  readonly allianceId: string;

  constructor(allianceId: string) {
    // User-facing copy matches data-management routes; keep id off the banner
    // (session /connect is the wrong recovery CTA for this setup gap).
    super("Alliance is not linked to Ashed.");
    this.name = "AllianceNotAshedLinkedError";
    this.allianceId = allianceId;
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
