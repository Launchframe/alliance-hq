import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 5000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error("health_check_timeout")), ms);
    }),
  ]);
}

/** Public liveness + DB/schema sanity for uptime monitors (no auth, no user data). */
export async function GET() {
  const ts = new Date().toISOString();
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  try {
    const db = getDb();
    await withTimeout(db.execute(sql`SELECT 1`), TIMEOUT_MS);

    await withTimeout(
      db.select({ id: schema.sessions.id }).from(schema.sessions).limit(1),
      TIMEOUT_MS,
    );

    return NextResponse.json({
      ok: true,
      db: true,
      schema: true,
      sha,
      ts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const schemaDrift =
      message.includes("Unknown field") ||
      message.includes("column") ||
      message.includes("does not exist");

    return NextResponse.json(
      {
        ok: false,
        db: !message.includes("health_check_timeout") && !schemaDrift,
        schema: false,
        sha,
        ts,
        errorClass: err instanceof Error ? err.constructor.name : "Error",
      },
      { status: 503 },
    );
  }
}
