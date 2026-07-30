import "server-only";

import { eq, gt } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { VsMembershipSettings } from "@/lib/vs-compliance/types.shared";

export type VsMembershipSettingsRow = VsMembershipSettings & {
  canManage: boolean;
};

function normalizeOptionalMinPoints(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

function normalizeStrikes(value: number | null | undefined): number {
  const n = Math.trunc(value ?? 3);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function normalizeLeewayPct(value: number | null | undefined): number {
  const n = Math.trunc(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function normalizeVsMembershipSettings(input: {
  minPoints?: number | null;
  missStrikesBeforeKick?: number | null;
  leewayPct?: number | null;
}): VsMembershipSettings {
  return {
    minPoints: normalizeOptionalMinPoints(input.minPoints),
    missStrikesBeforeKick: normalizeStrikes(input.missStrikesBeforeKick),
    leewayPct: normalizeLeewayPct(input.leewayPct),
  };
}

export async function loadVsMembershipSettings(
  allianceId: string,
  canManage: boolean,
): Promise<VsMembershipSettingsRow> {
  const db = getDb();
  const [row] = await db
    .select({
      minPoints: schema.alliances.vsMembershipMinPoints,
      missStrikesBeforeKick: schema.alliances.vsMembershipMissStrikesBeforeKick,
      leewayPct: schema.alliances.vsMembershipLeewayPct,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const settings = normalizeVsMembershipSettings({
    minPoints: row?.minPoints ?? null,
    missStrikesBeforeKick: row?.missStrikesBeforeKick ?? 3,
    leewayPct: row?.leewayPct ?? 0,
  });

  return { ...settings, canManage };
}

export async function saveVsMembershipSettings(
  allianceId: string,
  input: {
    minPoints?: number | null;
    missStrikesBeforeKick?: number | null;
    leewayPct?: number | null;
  },
): Promise<VsMembershipSettings> {
  const settings = normalizeVsMembershipSettings(input);
  const db = getDb();
  await db
    .update(schema.alliances)
    .set({
      vsMembershipMinPoints: settings.minPoints,
      vsMembershipMissStrikesBeforeKick: settings.missStrikesBeforeKick,
      vsMembershipLeewayPct: settings.leewayPct,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));

  return settings;
}

/** Alliances with VS membership enforcement turned on — target list for the weekly cron. */
export async function listAllianceIdsWithVsMembershipEnforcement(): Promise<
  string[]
> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(gt(schema.alliances.vsMembershipMinPoints, 0));

  return rows.map((row) => row.id);
}
