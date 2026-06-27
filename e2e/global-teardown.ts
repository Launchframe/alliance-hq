import { closeE2eSql } from "./fixtures/db";

// .env.local is generated and restored by scripts/e2e-server.mjs, which owns the
// full lifecycle and is the only thing that runs when the server fails to start
// (e.g. a failed db:migrate). Restoring it here too would double-restore on a
// successful run and could delete the developer's real .env.local.
export default async function globalTeardown() {
  await closeE2eSql();
}
