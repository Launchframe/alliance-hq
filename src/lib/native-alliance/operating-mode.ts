import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

import {
  ALLIANCE_OPERATING_MODES,
  type AllianceOperatingMode,
} from "./constants";

export function parseOperatingMode(
  value: string | null | undefined,
): AllianceOperatingMode {
  if (value === "native") return "native";
  return "ashed";
}

export async function getAllianceOperatingMode(
  allianceId: string,
): Promise<AllianceOperatingMode> {
  const db = getDb();
  const [row] = await db
    .select({ operatingMode: schema.alliances.operatingMode })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  return parseOperatingMode(row?.operatingMode);
}

export async function isNativeAlliance(allianceId: string): Promise<boolean> {
  return (await getAllianceOperatingMode(allianceId)) === "native";
}

export function isValidOperatingMode(value: string): value is AllianceOperatingMode {
  return (ALLIANCE_OPERATING_MODES as string[]).includes(value);
}
