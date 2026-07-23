import {
  resolveDatabaseUrl,
  resolveListenDatabaseUrl,
} from "./resolve-database-url";

export type { DatabaseUrlEnv } from "./resolve-database-url";
export {
  resolveDatabaseUrl,
  resolveListenDatabaseUrl,
  shouldPreferLocalDatabaseUrl,
} from "./resolve-database-url";

/**
 * Local dev: set LOCAL_DATABASE_URL (e.g. postgresql://localhost/alliance_hq).
 * Production / Neon: set DATABASE_URL.
 *
 * LOCAL_DATABASE_URL wins whenever set, except on Vercel production (VERCEL=1).
 */
export function getDatabaseUrl(): string {
  return normalizePostgresUrl(resolveDatabaseUrl(process.env));
}

/**
 * Direct (session) Postgres URL for LISTEN/SSE.
 * Prefers DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING over the pooler URL.
 */
export function getListenDatabaseUrl(): string {
  return normalizePostgresUrl(resolveListenDatabaseUrl(process.env));
}

/** Hostname only — safe to show in admin UI (no credentials). */
export function databaseHostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "unknown";
  }
}

export function getDatabaseHost(): string {
  return databaseHostFromUrl(getDatabaseUrl());
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
