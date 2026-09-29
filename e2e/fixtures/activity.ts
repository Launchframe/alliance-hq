import { getE2eSql } from "./db";

export type ActivitySeedRow = {
  id: string;
  eventKey: string;
  feature: string;
  kind: string;
  visibilityClass: "alliance" | "private";
  occurredAt?: string;
  allianceId?: string | null;
  actorKind?: string;
  originalHqUserId?: string | null;
  originalDiscordUserId?: string | null;
  personalOwnerHqUserId?: string | null;
  actorDisplayName?: string | null;
  actorHqRole?: string | null;
  actorGameRank?: string | null;
  serverNumber?: string | null;
  allianceTag?: string | null;
  allianceName?: string | null;
  channel?: string | null;
  method?: string | null;
  severity?: string;
  resourceKind?: string | null;
  resourceId?: string | null;
  payload: Record<string, unknown>;
  historical?: boolean;
};

const seededEventIds: string[] = [];

export async function seedActivityEvent(row: ActivitySeedRow) {
  const sql = getE2eSql();
  seededEventIds.push(row.id);
  await sql`
    INSERT INTO activity_events (
      id, event_key, feature, kind, occurred_at,
      alliance_id, actor_kind, original_hq_user_id, original_discord_user_id,
      personal_owner_hq_user_id, actor_display_name, actor_hq_role,
      actor_game_rank, server_number, alliance_tag, alliance_name, channel,
      method, severity, visibility_class, resource_kind, resource_id, payload,
      source_namespace, source_key, content_hash, historical
    ) VALUES (
      ${row.id}, ${row.eventKey}, ${row.feature}, ${row.kind},
      ${row.occurredAt ?? "2026-09-29T12:00:00.000000Z"},
      ${row.allianceId ?? null}, ${row.actorKind ?? "hq"},
      ${row.originalHqUserId ?? null}, ${row.originalDiscordUserId ?? null},
      ${row.personalOwnerHqUserId ?? null}, ${row.actorDisplayName ?? null},
      ${row.actorHqRole ?? null}, ${row.actorGameRank ?? null},
      ${row.serverNumber ?? null}, ${row.allianceTag ?? null},
      ${row.allianceName ?? null}, ${row.channel ?? "web"},
      ${row.method ?? "manual"}, ${row.severity ?? "update"},
      ${row.visibilityClass}, ${row.resourceKind ?? null},
      ${row.resourceId ?? null}, ${sql.json(row.payload)},
      ${"e2e-activity-privacy"}, ${row.id}, ${"e2e-content-hash"},
      ${row.historical ?? false}
    )
  `;
}

export async function cleanupSeededActivityEvents() {
  const sql = getE2eSql();
  const ids = seededEventIds.splice(0);
  if (ids.length > 0) {
    await sql`DELETE FROM activity_events WHERE id = ANY(${ids})`;
  }
}
