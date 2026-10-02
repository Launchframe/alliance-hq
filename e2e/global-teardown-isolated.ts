import { restoreEnvFile } from "../scripts/e2e-env-file.mjs";

import { closeE2eSql } from "./fixtures/db";

// The isolated server never rewrites `.env.local`. This is only a backstop for
// a leftover auto-generated file or parked backup from a SIGKILL of the legacy
// harness. `restoreEnvFile()` is idempotent and leaves a real `.env.local` alone.
export default async function globalTeardown() {
  await closeE2eSql();
  restoreEnvFile();
}
