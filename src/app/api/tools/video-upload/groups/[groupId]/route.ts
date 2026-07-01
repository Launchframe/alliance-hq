import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getOrCreateSession } from "@/lib/session";
import {
  resolveVideoUploadGroupAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";

type Props = { params: Promise<{ groupId: string }> };

export async function PATCH(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { groupId } = await params;
    const body = (await request.json()) as {
      selectedJobId?: string;
      accuracyJobId?: string;
    };

    const access = await resolveVideoUploadGroupAccess(
      groupId,
      session.id,
      "mutate",
    );
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }

    const db = getDb();

    const selectedJobId =
      typeof body.selectedJobId === "string" ? body.selectedJobId : undefined;
    const accuracyJobId =
      typeof body.accuracyJobId === "string" ? body.accuracyJobId : undefined;

    if (selectedJobId === "same") {
      return NextResponse.json({ error: "Invalid selected job" }, { status: 400 });
    }

    const jobIdsToValidate = [
      ...new Set(
        [selectedJobId, accuracyJobId].filter(
          (id): id is string => Boolean(id) && id !== "same",
        ),
      ),
    ];

    if (jobIdsToValidate.length > 0) {
      const siblingJobs = await db
        .select({ id: schema.videoJobs.id })
        .from(schema.videoJobs)
        .where(
          and(
            eq(schema.videoJobs.groupId, groupId),
            inArray(schema.videoJobs.id, jobIdsToValidate),
          ),
        );
      const siblingIds = new Set(siblingJobs.map((job) => job.id));
      const invalidJobId = jobIdsToValidate.find((id) => !siblingIds.has(id));
      if (invalidJobId) {
        return NextResponse.json({ error: "Invalid group job" }, { status: 400 });
      }
    }

    const patch: {
      updatedAt: Date;
      selectedJobId?: string;
      accuracyJobId?: string;
    } = { updatedAt: new Date() };
    if (selectedJobId) patch.selectedJobId = selectedJobId;
    if (accuracyJobId) patch.accuracyJobId = accuracyJobId;

    await db
      .update(schema.videoUploadGroups)
      .set(patch)
      .where(eq(schema.videoUploadGroups.id, groupId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 },
    );
  }
}
