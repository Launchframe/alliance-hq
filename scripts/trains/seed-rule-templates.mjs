import { config } from "dotenv";
import postgres from "postgres";

import { getDatabaseUrlFromProcessEnv } from "../lib/database-url.mjs";
import { PRESET_TEMPLATE_SEEDS } from "./preset-template-seeds.mjs";

config({ path: ".env" });
config({ path: ".env.local" });
if (process.env.NODE_ENV !== "production") {
  config({ path: ".env.development.local" });
}

/**
 * HQ week presets as `train_rule_templates` rows (`alliance_id IS NULL`).
 *
 * Idempotent: ids are derived from the preset key, so re-running updates the
 * shape in place rather than creating duplicates. Alliance-authored templates
 * and per-alliance archive rows are never touched.
 */
async function main() {
  const client = postgres(getDatabaseUrlFromProcessEnv(), {
    max: 1,
    prepare: false,
  });

  for (const preset of PRESET_TEMPLATE_SEEDS) {
    await client`
      INSERT INTO train_rule_templates (id, preset_key, name, description, days)
      VALUES (
        ${`tmpl_preset_${preset.key}`},
        ${preset.key},
        ${preset.name},
        ${preset.description ?? null},
        ${client.json(preset.days)}
      )
      ON CONFLICT (preset_key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        days = EXCLUDED.days,
        updated_at = now()
    `;
  }

  console.log(`Seeded ${PRESET_TEMPLATE_SEEDS.length} train rule templates`);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
