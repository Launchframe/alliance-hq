import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  clampTrainConductorLeadTimeDays,
} from "@/lib/trains/vs-week-days.shared";

export type AllianceTrainLeadTimeSettings = {
  trainConductorLeadTimeDays: number;
  trainConductorConfirmationEnabled: boolean;
  canManage: boolean;
};

export async function loadAllianceTrainLeadTimeDays(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({
      trainConductorLeadTimeDays: schema.alliances.trainConductorLeadTimeDays,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return clampTrainConductorLeadTimeDays(
    row?.trainConductorLeadTimeDays ?? 0,
  );
}

export async function loadAllianceTrainLeadTimeSettings(
  allianceId: string,
  canManage: boolean,
): Promise<AllianceTrainLeadTimeSettings> {
  const db = getDb();
  const [row] = await db
    .select({
      trainConductorLeadTimeDays: schema.alliances.trainConductorLeadTimeDays,
      trainConductorConfirmationEnabled:
        schema.alliances.trainConductorConfirmationEnabled,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return {
    trainConductorLeadTimeDays: clampTrainConductorLeadTimeDays(
      row?.trainConductorLeadTimeDays ?? 0,
    ),
    trainConductorConfirmationEnabled:
      (row?.trainConductorConfirmationEnabled ?? 0) === 1,
    canManage,
  };
}

export async function saveAllianceTrainLeadTimeSettings(
  allianceId: string,
  input: {
    trainConductorLeadTimeDays: number;
    trainConductorConfirmationEnabled: boolean;
  },
): Promise<Omit<AllianceTrainLeadTimeSettings, "canManage">> {
  const days = clampTrainConductorLeadTimeDays(input.trainConductorLeadTimeDays);
  const confirmationEnabled = input.trainConductorConfirmationEnabled ? 1 : 0;

  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      trainConductorLeadTimeDays: days,
      trainConductorConfirmationEnabled: confirmationEnabled,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));

  return {
    trainConductorLeadTimeDays: days,
    trainConductorConfirmationEnabled: confirmationEnabled === 1,
  };
}
