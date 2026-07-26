import { desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb, schema } from "@/lib/db";
import { withApiErrorHandler } from "@/lib/ops/api-error";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

async function getHandler() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  let health: Record<string, unknown> = { ok: false };
  try {
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:5175");
    const res = await fetch(`${base}/api/health`, { cache: "no-store" });
    health = (await res.json()) as Record<string, unknown>;
    health.httpStatus = res.status;
  } catch {
    health = { ok: false, error: "health_fetch_failed" };
  }

  const db = getDb();
  const recentFailures = await db
    .select()
    .from(schema.opsEvents)
    .where(inArray(schema.opsEvents.severity, ["error", "page"]))
    .orderBy(desc(schema.opsEvents.createdAt))
    .limit(10);

  const cronNames = await db
    .select({ name: schema.cronRuns.name })
    .from(schema.cronRuns)
    .groupBy(schema.cronRuns.name);

  const latestCronRuns = (
    await Promise.all(
      cronNames.map(async ({ name }) => {
        const [run] = await db
          .select()
          .from(schema.cronRuns)
          .where(eq(schema.cronRuns.name, name))
          .orderBy(desc(schema.cronRuns.startedAt))
          .limit(1);
        return run ?? null;
      }),
    )
  ).filter(Boolean);

  return NextResponse.json({
    health,
    recentFailures,
    latestCronRuns,
  });
}

export const GET = withApiErrorHandler(getHandler);
