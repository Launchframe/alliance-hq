/**
 * Vercel Web Analytics custom events for production ops signals.
 * No user identifiers, credentials, or alliance-specific data in payloads.
 */

import { postgresErrorCode } from "@/lib/db/error-message";

function vercelProductionAnalyticsEnabled(): boolean {
  return process.env.NODE_ENV === "production" && process.env.VERCEL === "1";
}

/** Postgres SQLSTATE when present on driver errors (e.g. 28P01 auth failure). */
export function postgresSqlState(error: unknown): string | null {
  const fromCauseChain = postgresErrorCode(error);
  if (fromCauseChain) {
    return fromCauseChain;
  }
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

export async function trackVercelCustomEvent(
  name: string,
  data: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (!vercelProductionAnalyticsEnabled()) {
    return;
  }
  try {
    const { track } = await import("@vercel/analytics/server");
    await track(name, data);
  } catch (error) {
    console.warn(
      "[vercel-analytics]",
      name,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function trackDatabaseHealthFailure(error: unknown): Promise<void> {
  const sqlState = postgresSqlState(error);
  await trackVercelCustomEvent("DB Health Check Failed", {
    sqlState: sqlState ?? "unknown",
  });
}
