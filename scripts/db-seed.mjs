import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Add new seed scripts here — each must be idempotent (safe on every deploy). */
const SEED_SCRIPTS = [
  "scripts/rbac/seed.mjs",
  "scripts/commendations/seed.mjs",
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  for (const script of SEED_SCRIPTS) {
    const path = join(root, script);
    console.log(`Running seed: ${script}`);
    const result = spawnSync(process.execPath, [path], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
  console.log(`All ${SEED_SCRIPTS.length} seed script(s) applied`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
