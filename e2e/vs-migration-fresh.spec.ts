import { readFileSync } from "node:fs";
import { join } from "node:path";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { assertE2eDatabaseUrl } from "../scripts/e2e-database-url-guard.mjs";

function migrationStatements(file: string, schemaName: string): string[] {
  const raw = readFileSync(join(__dirname, "..", "drizzle", file), "utf8");
  return raw
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) =>
      statement
        .replaceAll('"public".', `"${schemaName}".`)
        .replaceAll("public.", `${schemaName}.`),
    );
}

test("0190 vs constraints apply cleanly on a fresh install and the week guards fire", async () => {
  const url =
    process.env.E2E_DATABASE_URL?.trim() ||
    process.env.LOCAL_DATABASE_URL?.trim();
  if (!url) throw new Error("E2E database URL is not configured.");
  assertE2eDatabaseUrl(url);
  const sql = postgres(url, { max: 1, prepare: false });
  const schemaName = `vs_mig_${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
  try {
    await sql.unsafe(
      `CREATE TABLE "${schemaName}".alliances (id text PRIMARY KEY);
       CREATE TABLE "${schemaName}".hq_users (id text PRIMARY KEY)`,
    );
    for (const file of [
      "0189_vs_weekly_strategy_podium.sql",
      "0190_vs_constraints.sql",
    ]) {
      for (const statement of migrationStatements(file, schemaName)) {
        await sql.unsafe(
          `SET search_path TO "${schemaName}";\n${statement}`,
        );
      }
    }

    const [fk] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${schemaName}
        AND c.contype = 'f'
        AND c.conname IN (
          'vs_match_day_results_matchup_alliance_fk',
          'vs_match_observations_matchup_alliance_fk'
        )
    `;
    expect(fk!.count).toBe(2);

    const matchupId = nanoid(16);
    const allianceId = nanoid(16);
    await sql`
      INSERT INTO ${sql(`${schemaName}.alliances`)} (id) VALUES (${allianceId})
    `;
    const stubCount = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ${sql(`${schemaName}.alliances`)}
    `;
    expect(stubCount[0]!.count).toBe(1);
    await sql`
      INSERT INTO ${sql(`${schemaName}.vs_matchups`)} (id, alliance_id, week_start)
      VALUES (${matchupId}, ${allianceId}, '2026-09-21')
    `;

    await sql`
      INSERT INTO ${sql(`${schemaName}.vs_match_day_results`)}
        (id, alliance_id, matchup_id, recorded_date)
      VALUES (${nanoid(16)}, ${allianceId}, ${matchupId}, '2026-09-21')
    `;

    await expect(
      sql`
        INSERT INTO ${sql(`${schemaName}.vs_match_day_results`)}
          (id, alliance_id, matchup_id, recorded_date)
        VALUES (${nanoid(16)}, ${allianceId}, ${matchupId}, '2026-09-27')
      `,
    ).rejects.toThrow(/invalid_vs_match_day/);

    await expect(
      sql`
        UPDATE ${sql(`${schemaName}.vs_matchups`)} SET week_start = '2026-09-28'
        WHERE id = ${matchupId}
      `,
    ).rejects.toThrow(/immutable_vs_matchup_week/);

    const inserted = await sql<{ sequence: string }[]>`
      INSERT INTO ${sql(`${schemaName}.vs_match_observations`)}
        (id, alliance_id, matchup_id, recorded_date, source, request_id, content_hash, snapshot)
      VALUES
        (${nanoid(16)}, ${allianceId}, ${matchupId}, '2026-09-21', 'hq_manual', 'r1', 'h1', '{}'),
        (${nanoid(16)}, ${allianceId}, ${matchupId}, '2026-09-22', 'hq_manual', 'r2', 'h2', '{}')
      RETURNING sequence
    `;
    expect(BigInt(inserted[1]!.sequence)).toBeGreaterThan(
      BigInt(inserted[0]!.sequence),
    );
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end({ timeout: 5 });
  }
});

test("0191 applies on a fresh install and backfills opponent scores from pre-0191 HQ-confirmed final heads", async () => {
  const url =
    process.env.E2E_DATABASE_URL?.trim() ||
    process.env.LOCAL_DATABASE_URL?.trim();
  if (!url) throw new Error("E2E database URL is not configured.");
  assertE2eDatabaseUrl(url);
  const sql = postgres(url, { max: 1, prepare: false });
  const schemaName = `vs_mig_${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
  try {
    await sql.unsafe(
      `CREATE TABLE "${schemaName}".alliances (id text PRIMARY KEY);
       CREATE TABLE "${schemaName}".hq_users (id text PRIMARY KEY)`,
    );
    for (const file of [
      "0189_vs_weekly_strategy_podium.sql",
      "0190_vs_constraints.sql",
    ]) {
      for (const statement of migrationStatements(file, schemaName)) {
        await sql.unsafe(
          `SET search_path TO "${schemaName}";\n${statement}`,
        );
      }
    }

    const allianceId = nanoid(16);
    const matchupId = nanoid(16);
    const importedMatchupId = nanoid(16);
    await sql`
      INSERT INTO ${sql(`${schemaName}.alliances`)} (id) VALUES (${allianceId})
    `;
    await sql`
      INSERT INTO ${sql(`${schemaName}.vs_matchups`)}
        (id, alliance_id, week_start, opponent_name, opponent_tag, identity_source)
      VALUES
        (${matchupId}, ${allianceId}, '2026-09-21', 'Rival', 'RVL', 'hq_manual'),
        (${importedMatchupId}, ${allianceId}, '2026-09-28', 'Other', 'OTH', 'ashed_import')
    `;
    await sql`
      INSERT INTO ${sql(`${schemaName}.vs_match_day_results`)}
        (id, alliance_id, matchup_id, recorded_date, our_score, opponent_score, outcome, finality, hq_confirmed)
      VALUES
        (${nanoid(16)}, ${allianceId}, ${matchupId}, '2026-09-21', 100, 42, 'won', 'final', 1),
        (${nanoid(16)}, ${allianceId}, ${matchupId}, '2026-09-22', 50, 7, 'pending', 'unconfirmed', 0)
    `;

    for (const statement of migrationStatements(
      "0191_vs_opponent_sync_capture.sql",
      schemaName,
    )) {
      await sql.unsafe(`SET search_path TO "${schemaName}";\n${statement}`);
    }

    const rows = await sql<
      {
        id: string;
        opponent_daily_scores: unknown;
        opponent_info_owned_fields: unknown;
      }[]
    >`
      SELECT id, opponent_daily_scores, opponent_info_owned_fields
      FROM ${sql(`${schemaName}.vs_matchups`)}
      ORDER BY week_start
    `;
    expect(rows).toHaveLength(2);
    const manual = rows.find((row) => row.id === matchupId)!;
    const imported = rows.find((row) => row.id === importedMatchupId)!;
    expect(manual.opponent_daily_scores).toEqual([
      "42",
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(manual.opponent_info_owned_fields).toEqual([
      "day:1",
      "opponentName",
      "opponentTag",
    ]);
    expect(imported.opponent_daily_scores).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(imported.opponent_info_owned_fields).toEqual([]);

    await expect(
      sql`
        UPDATE ${sql(`${schemaName}.vs_matchups`)}
        SET opponent_daily_scores = jsonb_build_array('007', null, null, null, null, null)
        WHERE id = ${matchupId}
      `,
    ).rejects.toThrow(/vs_matchups_opponent_scores_check/);

    await expect(
      sql`
        INSERT INTO ${sql(`${schemaName}.vs_matchup_ashed_sync`)}
          (matchup_id, alliance_id, dirty_fields)
        VALUES (${matchupId}, ${allianceId}, '["bogus"]'::jsonb)
      `,
    ).rejects.toThrow(/vs_matchup_ashed_sync_dirty_fields_check/);
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end({ timeout: 5 });
  }
});
