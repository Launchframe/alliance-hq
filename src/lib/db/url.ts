/**
 * Local dev: set LOCAL_DATABASE_URL (e.g. postgresql://localhost/alliance_hq).
 * Production / Neon: set DATABASE_URL.
 *
 * When NODE_ENV is not production, LOCAL_DATABASE_URL wins if set.
 */
export function getDatabaseUrl(): string {
  const isProduction = process.env.NODE_ENV === "production";
  const local = process.env.LOCAL_DATABASE_URL?.trim();

  let raw: string | undefined;
  if (!isProduction && local) {
    raw = local;
  } else {
    raw = process.env.DATABASE_URL?.trim() ?? local;
  }

  if (!raw) {
    throw new Error(
      isProduction
        ? "DATABASE_URL is not set"
        : "Set LOCAL_DATABASE_URL (local Postgres) or DATABASE_URL in .env.local",
    );
  }

  return normalizePostgresUrl(raw);
}

/** Strip Prisma-style query params that libpq / postgres.js reject. */
export function normalizePostgresUrl(raw: string): string {
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
