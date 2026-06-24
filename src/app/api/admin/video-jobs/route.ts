import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam === null ? "failed" : statusParam;
  const bucket = url.searchParams.get("bucket");
  const passKey = url.searchParams.get("passKey");
  const rating = url.searchParams.get("rating");
  const ratingReason = url.searchParams.get("ratingReason");
  const scoreTarget = url.searchParams.get("scoreTarget");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

  const db = getDb();

  const conditions = [
    status ? eq(schema.videoJobs.status, status) : undefined,
    bucket ? eq(schema.videoJobs.qualityBucket, bucket) : undefined,
    passKey ? eq(schema.videoJobs.passKey, passKey) : undefined,
    rating ? eq(schema.videoJobs.rating, rating) : undefined,
    ratingReason ? eq(schema.videoJobs.ratingReason, ratingReason) : undefined,
    scoreTarget ? eq(schema.videoJobs.scoreTarget, scoreTarget) : undefined,
  ].filter(Boolean) as Parameters<typeof and>;

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(schema.videoJobs)
          .where(and(...conditions))
          .orderBy(desc(schema.videoJobs.createdAt))
          .limit(limit)
      : await db
          .select()
          .from(schema.videoJobs)
          .orderBy(desc(schema.videoJobs.createdAt))
          .limit(limit);

  return NextResponse.json({ jobs: rows });
}
