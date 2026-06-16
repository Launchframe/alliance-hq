import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";

type Props = { params: Promise<{ jobId: string }> };

export async function PATCH(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const { jobId } = await params;
  const db = getDb();
  await db
    .update(schema.videoJobs)
    .set({ status: "discarded", updatedAt: new Date() })
    .where(
      and(
        eq(schema.videoJobs.id, jobId),
        eq(schema.videoJobs.sessionId, session.id),
      ),
    );
  return NextResponse.json({ ok: true });
}
