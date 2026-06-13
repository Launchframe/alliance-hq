import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local" });
config({ path: ".env" });

function getDatabaseUrl() {
  const isProduction = process.env.NODE_ENV === "production";
  const local = process.env.LOCAL_DATABASE_URL?.trim();
  let raw = !isProduction && local ? local : process.env.DATABASE_URL?.trim() ?? local;
  if (!raw) throw new Error("DATABASE_URL / LOCAL_DATABASE_URL not set");
  try {
    const url = new URL(raw);
    url.searchParams.delete("schema");
    return url.toString();
  } catch {
    return raw;
  }
}

function migrationHash(tag) {
  const sql = readFileSync(`drizzle/${tag}.sql`, "utf8");
  return createHash("sha256").update(sql).digest("hex");
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
  const url = getDatabaseUrl();
  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client);

  await baselinePushCreatedSchema(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Migrations applied");
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
