import { restoreEnvFile } from "../scripts/e2e-env-file.mjs";

import { closeE2eSql } from "./fixtures/db";

// scripts/e2e-server.mjs owns the .env.local backup/restore lifecycle and is the
// only thing that runs when the server fails to start (e.g. a failed db:migrate).
// We ALSO restore here as a backstop: globalTeardown runs in Playwright's main
// process, so it recovers the developer's .env.local even if the server child was
// SIGKILLed and never ran its own exit handler. restoreEnvFile() is idempotent
// and filesystem-driven, so a double restore on a clean run is a safe no-op.
export default async function globalTeardown() {
  await closeE2eSql();
  restoreEnvFile();
}
