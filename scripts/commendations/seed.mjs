import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });
config({ path: ".env" });

const DEFAULT_COMMENDATIONS = [
  { slug: "valor", label: "Valor", sortOrder: 1 },
  { slug: "leadership", label: "Leadership", sortOrder: 2 },
  { slug: "service", label: "Service", sortOrder: 3 },
];

function getDatabaseUrl() {
  const isProduction = process.env.NODE_ENV === "production";
  const local = process.env.LOCAL_DATABASE_URL?.trim();
  let raw =
    !isProduction && local ? local : (process.env.DATABASE_URL?.trim() ?? local);
  if (!raw) throw new Error("DATABASE_URL / LOCAL_DATABASE_URL not set");
  try {
    const url = new URL(raw);
    url.searchParams.delete("schema");
    return url.toString();
  } catch {
    return raw;
  }
}

async function main() {
  const client = postgres(getDatabaseUrl(), { max: 1, prepare: false });

  for (const row of DEFAULT_COMMENDATIONS) {
    await client`
      INSERT INTO hq_commendations (id, slug, label, sort_order, active, created_at)
      VALUES (
        ${`cmd-${row.slug}`},
        ${row.slug},
        ${row.label},
        ${row.sortOrder},
        1,
        now()
      )
      ON CONFLICT (slug) DO UPDATE SET
        label = EXCLUDED.label,
        sort_order = EXCLUDED.sort_order
    `;
  }

  console.log(`Seeded ${DEFAULT_COMMENDATIONS.length} default commendations`);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
