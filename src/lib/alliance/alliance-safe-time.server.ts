import { eq } from "drizzle-orm";

import {
  isAllianceSafeTimeSlot,
  type AllianceSafeTimeSlot,
} from "@/lib/alliance/alliance-safe-time.shared";
import { getDb, schema } from "@/lib/db";

export type AllianceSafeTimeSettings = {
  allianceSafeTimeSlot: AllianceSafeTimeSlot | null;
  canManage: boolean;
};

export async function loadAllianceSafeTimeSettings(
  allianceId: string,
  canManage: boolean,
): Promise<AllianceSafeTimeSettings> {
  const db = getDb();
  const [row] = await db
    .select({
      allianceSafeTimeSlot: schema.alliances.allianceSafeTimeSlot,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const slot = row?.allianceSafeTimeSlot;
  return {
    allianceSafeTimeSlot: isAllianceSafeTimeSlot(slot) ? slot : null,
    canManage,
  };
}

export async function saveAllianceSafeTimeSlot(
  allianceId: string,
  allianceSafeTimeSlot: AllianceSafeTimeSlot,
): Promise<{ allianceSafeTimeSlot: AllianceSafeTimeSlot }> {
  if (!isAllianceSafeTimeSlot(allianceSafeTimeSlot)) {
    throw new Error("Invalid alliance safe time slot.");
  }

  const db = getDb();
  await db
    .update(schema.alliances)
    .set({ allianceSafeTimeSlot, updatedAt: new Date() })
    .where(eq(schema.alliances.id, allianceId));

  return { allianceSafeTimeSlot };
}

export async function loadAllianceSafeTimeSlot(
  allianceId: string,
): Promise<AllianceSafeTimeSlot | null> {
  const settings = await loadAllianceSafeTimeSettings(allianceId, false);
  return settings.allianceSafeTimeSlot;
}
