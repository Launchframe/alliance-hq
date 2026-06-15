import { config } from "dotenv";
import postgres from "postgres";

import { getDatabaseUrlFromProcessEnv } from "../lib/database-url.mjs";

config({ path: ".env" });
config({ path: ".env.local" });
if (process.env.NODE_ENV !== "production") {
  config({ path: ".env.development.local" });
}

const DEFAULT_COMMENDATIONS = [
  { slug: "valor", label: "Valor", sortOrder: 1 },
  { slug: "leadership", label: "Leadership", sortOrder: 2 },
  { slug: "service", label: "Service", sortOrder: 3 },
];

async function main() {
  const client = postgres(getDatabaseUrlFromProcessEnv(), { max: 1, prepare: false });

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
