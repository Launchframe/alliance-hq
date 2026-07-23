export type DatabaseUrlEnv = {
  NODE_ENV?: string;
  VERCEL?: string;
  LOCAL_DATABASE_URL?: string;
  DATABASE_URL?: string;
  /** Neon direct (non-pooler) URL — required for Postgres LISTEN/NOTIFY. */
  DATABASE_URL_UNPOOLED?: string;
  /** Neon integration alias for the direct URL. */
  POSTGRES_URL_NON_POOLING?: string;
};

/**
 * Prefer local Postgres when LOCAL_DATABASE_URL is set, except on Vercel production
 * runtimes (VERCEL=1 + NODE_ENV=production) where DATABASE_URL is authoritative.
 *
 * This covers:
 * - next dev / test — LOCAL wins over Neon in DATABASE_URL
 * - next start on a laptop — LOCAL still wins (NODE_ENV=production but not Vercel)
 * - vercel dev — LOCAL wins (NODE_ENV=development)
 * - Vercel production deploy — DATABASE_URL only
 *
 * One-off prod ops from a laptop: unset LOCAL_DATABASE_URL or pass an empty value
 * when running db:migrate with an explicit DATABASE_URL.
 */
export function shouldPreferLocalDatabaseUrl(env: DatabaseUrlEnv): boolean {
  const local = env.LOCAL_DATABASE_URL?.trim();
  if (!local) {
    return false;
  }
  if (env.VERCEL === "1" && env.NODE_ENV === "production") {
    return false;
  }
  return true;
}

export function resolveDatabaseUrl(env: DatabaseUrlEnv): string {
  const isProduction = env.NODE_ENV === "production";
  const local = env.LOCAL_DATABASE_URL?.trim();

  let raw: string | undefined;
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

/**
 * Connection string for session-scoped Postgres features (`LISTEN` / `NOTIFY`).
 *
 * Neon’s PgBouncer pooler runs in transaction mode and does **not** support
 * LISTEN/NOTIFY. Prefer the direct (unpooled) URL when present; otherwise fall
 * back to {@link resolveDatabaseUrl} (fine for local Postgres).
 *
 * Resolution order after the normal local/prod preference:
 * 1. DATABASE_URL_UNPOOLED (Neon ↔ Vercel integration)
 * 2. POSTGRES_URL_NON_POOLING (Neon integration alias)
 * 3. resolveDatabaseUrl() (LOCAL_DATABASE_URL or DATABASE_URL)
 */
export function resolveListenDatabaseUrl(env: DatabaseUrlEnv): string {
  if (shouldPreferLocalDatabaseUrl(env)) {
    return resolveDatabaseUrl(env);
  }

  const unpooled =
    env.DATABASE_URL_UNPOOLED?.trim() ||
    env.POSTGRES_URL_NON_POOLING?.trim();
  if (unpooled) {
    return unpooled;
  }

  return resolveDatabaseUrl(env);
}
