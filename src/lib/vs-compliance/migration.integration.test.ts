import { readFileSync } from "node:fs";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import { createNativeAlliance, getE2eSql } from "../../../e2e/fixtures/db";

const migration = readFileSync(new URL("../../../drizzle/0137_vs_compliance.sql", import.meta.url), "utf8");

describe.skipIf(process.env.VS_COMPLIANCE_DB_TEST !== "1")("compliance migration against the guarded e2e database", () => {
  it("preserves legacy events, retires unsafe legacy tasks and remains idempotent", async () => {
    const sql = getE2eSql();
    await sql.unsafe(`
      ALTER TABLE alliances ADD COLUMN IF NOT EXISTS vs_membership_min_points integer;
      ALTER TABLE alliances ADD COLUMN IF NOT EXISTS vs_membership_miss_strikes_before_kick integer NOT NULL DEFAULT 3;
      ALTER TABLE alliances ADD COLUMN IF NOT EXISTS vs_membership_leeway_pct integer NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS member_vs_compliance_events (
        id text PRIMARY KEY, alliance_id text NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
        ashed_member_id text NOT NULL, member_name text NOT NULL, vs_week_ending text NOT NULL,
        score integer NOT NULL, threshold integer NOT NULL, excused boolean NOT NULL DEFAULT false,
        outcome text NOT NULL, strike_number integer, officer_task_status text NOT NULL DEFAULT 'none',
        waive_reason text, completed_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
        waived_by_hq_user_id text REFERENCES hq_users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const alliance = await createNativeAlliance(sql, { tag: `LC${nanoid(6)}`, name: "Legacy migration fixture" });
    const eventId = nanoid();
    const inboxId = nanoid();
    await sql`UPDATE alliances SET vs_membership_min_points = 40000000 WHERE id = ${alliance.allianceId}`;
    await sql`INSERT INTO member_vs_compliance_events (id, alliance_id, ashed_member_id, member_name, vs_week_ending, score, threshold, outcome, officer_task_status) VALUES (${eventId}, ${alliance.allianceId}, 'legacy-member', 'Legacy member', '2026-08-30', 7, 40000000, 'missed', 'pending')`;
    await sql`INSERT INTO inbox_reminder_items (id, alliance_id, kind, title, required_permission, active) VALUES (${inboxId}, ${alliance.allianceId}, 'vs_demotion_task', 'Legacy task', 'members:write', 1)`;
    for (let pass = 0; pass < 2; pass++) {
      await sql.unsafe(migration);
      const [legacy] = await sql`SELECT score, officer_task_status FROM member_vs_compliance_events WHERE id = ${eventId}`;
      expect(legacy).toMatchObject({ score: 7, officer_task_status: "pending" });
      const [item] = await sql`SELECT active, required_permission FROM inbox_reminder_items WHERE id = ${inboxId}`;
      expect(item).toMatchObject({ active: 0, required_permission: "vs_compliance:read" });
      const [policies] = await sql`SELECT count(*)::integer AS count FROM vs_compliance_policies WHERE alliance_id = ${alliance.allianceId}`;
      expect(policies.count).toBe(0);
    }
  }, 30_000);
});
