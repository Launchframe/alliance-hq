import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  effectiveAllianceHqOcrOnly,
  isAshedOcrAvailableOnDeploy,
} from "@/lib/video/ocr-provider.shared";

/** Stored alliance preference for in-house OCR (ignores deploy override). */
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

/** Effective OCR mode for pipeline + UI (forces in-house when Ashed is unavailable). */
export async function loadEffectiveAllianceHqOcrOnly(
  allianceId: string,
): Promise<boolean> {
  return effectiveAllianceHqOcrOnly(await loadAllianceHqOcrOnly(allianceId));
}

export function isAllianceHqOcrOnlyLockedOnDeploy(): boolean {
  return !isAshedOcrAvailableOnDeploy();
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
