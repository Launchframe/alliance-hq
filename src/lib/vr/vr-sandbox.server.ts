import "server-only";

import { and, eq, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { buildSandboxSeasonKey } from "@/lib/vr/vr-sandbox.shared";

export type VrSandboxSettings = {
  enabled: boolean;
  seasonKey: string | null;
  canManage: boolean;
};

export async function getAllianceVrSandboxState(allianceId: string): Promise<{
  enabled: boolean;
  seasonKey: string | null;
}> {
  const db = getDb();
  const [row] = await db
    .select({
      enabled: schema.alliances.vrSandboxEnabled,
      seasonKey: schema.alliances.vrSandboxSeasonKey,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return {
    enabled: row?.enabled === 1,
    seasonKey: row?.seasonKey?.trim() || null,
  };
}

export async function wipeVrSandboxData(
  allianceId: string,
  sandboxSeasonKey: string,
): Promise<void> {
  const db = getDb();
  const seasonKey = sandboxSeasonKey.trim();
  if (!seasonKey) {
    return;
  }

  await db
    .delete(schema.memberSeasonVrEvents)
    .where(
      and(
        eq(schema.memberSeasonVrEvents.allianceId, allianceId),
        eq(schema.memberSeasonVrEvents.seasonKey, seasonKey),
      ),
    );
  await db
    .delete(schema.memberSeasonVr)
    .where(
      and(
        eq(schema.memberSeasonVr.allianceId, allianceId),
        eq(schema.memberSeasonVr.seasonKey, seasonKey),
      ),
    );
  await db
    .delete(schema.commanderSeasonVrEvents)
    .where(
      and(
        eq(schema.commanderSeasonVrEvents.allianceId, allianceId),
        eq(schema.commanderSeasonVrEvents.seasonKey, seasonKey),
      ),
    );
  // Sandbox season keys are unique per alliance; wipe commander summary by season key.
  await db
    .delete(schema.commanderSeasonVr)
    .where(eq(schema.commanderSeasonVr.seasonKey, seasonKey));
  await db
    .delete(schema.hqVrPending)
    .where(eq(schema.hqVrPending.allianceId, allianceId));
  // VR-only pending — preserve in-flight /link walkthroughs and identity confirms.
  await db
    .delete(schema.discordBotPending)
    .where(
      and(
        eq(schema.discordBotPending.allianceId, allianceId),
        or(
          sql`${schema.discordBotPending.pendingJson}->>'kind' = 'anomaly_confirm'`,
          sql`${schema.discordBotPending.pendingJson}->>'kind' = 'pick_character'`,
        ),
      ),
    );
}

export async function setAllianceVrSandboxEnabled(
  allianceId: string,
  enabled: boolean,
): Promise<{ enabled: boolean; seasonKey: string | null }> {
  const db = getDb();
  const current = await getAllianceVrSandboxState(allianceId);

  if (!enabled) {
    if (current.enabled && current.seasonKey) {
      await wipeVrSandboxData(allianceId, current.seasonKey);
    }
    await db
      .update(schema.alliances)
      .set({
        vrSandboxEnabled: 0,
        vrSandboxSeasonKey: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.alliances.id, allianceId));
    return { enabled: false, seasonKey: null };
  }

  if (current.enabled && current.seasonKey) {
    return { enabled: true, seasonKey: current.seasonKey };
  }

  const seasonKey = buildSandboxSeasonKey(nanoid(10));
  await db
    .update(schema.alliances)
    .set({
      vrSandboxEnabled: 1,
      vrSandboxSeasonKey: seasonKey,
      updatedAt: new Date(),
    })
    .where(eq(schema.alliances.id, allianceId));
  return { enabled: true, seasonKey };
}

export async function loadVrSandboxSettings(
  allianceId: string,
  canManage: boolean,
): Promise<VrSandboxSettings> {
  const state = await getAllianceVrSandboxState(allianceId);
  return {
    enabled: state.enabled,
    seasonKey: canManage ? state.seasonKey : null,
    canManage,
  };
}

export async function saveVrSandboxSettings(
  allianceId: string,
  enabled: boolean,
): Promise<VrSandboxSettings> {
  const saved = await setAllianceVrSandboxEnabled(allianceId, enabled);
  return {
    enabled: saved.enabled,
    seasonKey: saved.seasonKey,
    canManage: true,
  };
}
