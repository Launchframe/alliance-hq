import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";
import { getExtractionPassComparison } from "@/lib/video/group-comparisons.shared";

type Props = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;
    const db = getDb();

    const access = await resolveVideoJobAccess(jobId, session.id, "read");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }

    const groupId = access.job.groupId;
    if (!groupId) {
      return NextResponse.json({ group: null, passes: [] });
    }

    const [group] = await db
      .select()
      .from(schema.videoUploadGroups)
      .where(eq(schema.videoUploadGroups.id, groupId))
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
      .where(eq(schema.videoJobs.groupId, groupId))
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
