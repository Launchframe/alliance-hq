/**
 * Refuse e2e harness/fixture DB access unless the database name contains "e2e".
 * Shared by scripts/e2e-server.mjs and e2e/fixtures/db.ts.
 *
 * @param {string} url
 */
export function assertE2eDatabaseUrl(url) {
  let dbName = "";
  try {
    dbName = new URL(url).pathname.replace(/^\//, "");
  } catch {
    dbName = url;
  }
  if (!/e2e/i.test(dbName)) {
    throw new Error(
      `Refusing to run e2e against a non-e2e database (${dbName || "unknown"}). ` +
        'Set E2E_DATABASE_URL to a dedicated e2e database (name must contain "e2e").',
    );
  }
}
