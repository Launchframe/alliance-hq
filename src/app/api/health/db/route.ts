import { NextResponse } from "next/server";

import { trackDatabaseHealthFailure } from "@/lib/analytics/vercel-observability";
import { getDb, schema, withPostgresAuthRecovery } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";

export const dynamic = "force-dynamic";

/** GET /api/health/db — quick check that env + Postgres + tables are wired. */
export async function GET() {
  try {
    const url = getDatabaseUrl();
    await withPostgresAuthRecovery(async () => {
      const db = getDb();
      await db
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .limit(1);
    });

    return NextResponse.json({
      ok: true,
      database: url.replace(/:[^:@/]+@/, ":***@"),
      tables: ["sessions", "ashed_credentials", "video_jobs"],
    });
  } catch (error) {
    await trackDatabaseHealthFailure(error);
    return NextResponse.json(
      {
        ok: false,
        error:
          process.env.NODE_ENV === "development"
            ? error instanceof Error
              ? error.message
              : String(error)
            : "database check failed",
      },
      { status: 500 },
    );
  }
}
