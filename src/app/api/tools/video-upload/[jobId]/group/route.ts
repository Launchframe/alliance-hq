import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import type { PassComparison } from "@/lib/video/compare-pass-results";
import { getExtractionPassComparison } from "@/lib/video/group-comparisons.shared";

type Props = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const db = getDb();

    const [job] = await db
      .select({ groupId: schema.videoJobs.groupId })
      .from(schema.videoJobs)
      .where(and(eq(schema.videoJobs.id, jobId), eq(schema.videoJobs.sessionId, session.id)))
      .limit(1);

    if (!job?.groupId) {
      return NextResponse.json({ group: null, passes: [] });
    }

    const [group] = await db
      .select()
      .from(schema.videoUploadGroups)
      .where(eq(schema.videoUploadGroups.id, job.groupId))
      .limit(1);

    if (!group) {
      return NextResponse.json({ group: null, passes: [] });
    }

    const passes = await db
      .select({
        id: schema.videoJobs.id,
        passKey: schema.videoJobs.passKey,
        passIndex: schema.videoJobs.passIndex,
        passRole: schema.videoJobs.passRole,
        status: schema.videoJobs.status,
        frameCount: schema.videoJobs.frameCount,
        parseSessionId: schema.videoJobs.parseSessionId,
      })
      .from(schema.videoJobs)
      .where(eq(schema.videoJobs.groupId, job.groupId))
      .orderBy(schema.videoJobs.passIndex);

    return NextResponse.json({
      group: {
        id: group.id,
        primaryJobId: group.primaryJobId,
        selectedJobId: group.selectedJobId,
        accuracyJobId: group.accuracyJobId,
        comparisonJson: getExtractionPassComparison(group.comparisonJson),
      },
      passes,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load group" },
      { status: 500 },
    );
  }
}
