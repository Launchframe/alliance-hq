/**
 * Keep in sync with src/lib/db/resolve-database-url.ts — contract tested in url.test.ts
 */

/** @param {import("../../src/lib/db/resolve-database-url.ts").DatabaseUrlEnv} env */
export function shouldPreferLocalDatabaseUrl(env) {
  const local = env.LOCAL_DATABASE_URL?.trim();
  if (!local) {
    return false;
  }
  if (env.VERCEL === "1" && env.NODE_ENV === "production") {
    return false;
  }
  return true;
}

/** @param {import("../../src/lib/db/resolve-database-url.ts").DatabaseUrlEnv} env */
export function resolveDatabaseUrl(env) {
  const isProduction = env.NODE_ENV === "production";
  const local = env.LOCAL_DATABASE_URL?.trim();

  let raw;
  if (shouldPreferLocalDatabaseUrl(env)) {
    raw = local;
  } else {
    const vercelProduction =
      env.VERCEL === "1" && env.NODE_ENV === "production";
    raw = env.DATABASE_URL?.trim() ?? (vercelProduction ? undefined : local);
  }

  if (!raw) {
    throw new Error(
      isProduction
        ? "DATABASE_URL is not set"
        : "Set LOCAL_DATABASE_URL (local Postgres) or DATABASE_URL in .env.local",
    );
  }

  return raw;
}

export function normalizePostgresUrl(raw) {
  try {
    const url = new URL(raw);
    url.searchParams.delete("schema");
    url.searchParams.delete("connection_limit");
    url.searchParams.delete("pool_timeout");
    url.searchParams.delete("connect_timeout");
    url.searchParams.delete("socket_timeout");
    return url.toString();
  } catch {
    return raw.replace(/\?schema=[^&]+&?/, "?").replace(/\?$/, "");
  }
}

export function getDatabaseUrlFromProcessEnv() {
  return normalizePostgresUrl(resolveDatabaseUrl(process.env));
}
