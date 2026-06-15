export type DatabaseUrlEnv = {
  NODE_ENV?: string;
  VERCEL?: string;
  LOCAL_DATABASE_URL?: string;
  DATABASE_URL?: string;
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
