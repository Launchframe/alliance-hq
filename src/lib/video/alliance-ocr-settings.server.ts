import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/** Whether this alliance runs video OCR through in-house Tesseract (no Ashed). */
export async function loadAllianceHqOcrOnly(
  allianceId: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ videoHqOcrOnly: schema.alliances.videoHqOcrOnly })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row?.videoHqOcrOnly === 1;
}

export async function setAllianceHqOcrOnly(
  allianceId: string,
  enabled: boolean,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      videoHqOcrOnly: enabled ? 1 : 0,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));
}
