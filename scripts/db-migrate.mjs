import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { getDatabaseUrlFromProcessEnv } from "./lib/database-url.mjs";

config({ path: ".env" });
config({ path: ".env.local" });
if (process.env.NODE_ENV !== "production") {
  config({ path: ".env.development.local" });
}

function migrationHash(tag) {
  const sql = readFileSync(`drizzle/${tag}.sql`, "utf8");
  return createHash("sha256").update(sql).digest("hex");
}

function readJournalEntries() {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  );
  return journal.entries ?? [];
}

async function migrationHashApplied(client, hash) {
  const [row] = await client`
    SELECT 1 AS ok FROM drizzle.__drizzle_migrations WHERE hash = ${hash} LIMIT 1
  `;
  return Boolean(row?.ok);
}

async function applyMissingJournalMigrations(client) {
  for (const entry of readJournalEntries()) {
    const tag = entry.tag;
    const hash = migrationHash(tag);
    if (await migrationHashApplied(client, hash)) {
      continue;
    }

    const sqlFile = readFileSync(`drizzle/${tag}.sql`, "utf8");
    const statements = sqlFile
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      try {
        await client.unsafe(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          !/already exists|duplicate column|duplicate key value/i.test(message)
        ) {
          throw error;
        }
      }
    }

    await client`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${entry.when ?? Date.now()})
    `;
    console.log(`Applied missing migration ${tag}`);
  }
}

async function baselinePushCreatedSchema(client) {
  const applied = await client`
    SELECT hash FROM drizzle.__drizzle_migrations
  `;
  if (applied.length > 0) return;

  const [{ reg }] = await client`
    SELECT to_regclass('public.sessions') AS reg
  `;
  if (!reg) return;

  const hash = migrationHash("0000_shallow_kat_farrell");
  await client`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${Date.now()})
  `;
  console.log("Baselined migration 0000 (schema was created via db:push)");
}

async function main() {
  const url = getDatabaseUrlFromProcessEnv();
  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client);

  await baselinePushCreatedSchema(client);
  await applyMissingJournalMigrations(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Migrations applied");
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
