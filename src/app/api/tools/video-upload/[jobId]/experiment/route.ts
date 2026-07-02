import { NextResponse } from "next/server";

import { getOrCreateSession } from "@/lib/session";
import { sessionCanProcessVideo } from "@/lib/video/processor-slots.server";
import {
  setVideoUploadGroupExperiment,
  buildVideoProcessPreview,
} from "@/lib/video/video-process-preview.server";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";

type Props = {
  params: Promise<{ jobId: string }>;
};

type Body = {
  campaignId?: string | null;
  armId?: string | null;
};

export async function PATCH(request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;

    if (!(await sessionCanProcessVideo(session.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const access = await resolveVideoJobAccess(jobId, session.id, "mutate");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }

    const job = access.job;
    if (job.status !== "pending_approval") {
      return NextResponse.json(
        { error: "Only pending jobs can change experiment assignment." },
        { status: 409 },
      );
    }

    if (!job.groupId) {
      return NextResponse.json(
        { error: "Job has no upload group." },
        { status: 409 },
      );
    }

    const body = (await request.json()) as Body;
    const campaignId =
      body.campaignId === undefined ? null : body.campaignId;
    const armId = body.armId === undefined ? null : body.armId;

    if ((campaignId && !armId) || (!campaignId && armId)) {
      return NextResponse.json(
        { error: "campaignId and armId must be set together, or both cleared." },
        { status: 400 },
      );
    }

    await setVideoUploadGroupExperiment({
      groupId: job.groupId,
      campaignId,
      armId,
    });

    const preview = await buildVideoProcessPreview({
      job,
      sessionId: session.id,
    });

    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update experiment",
      },
      { status: 500 },
    );
  }
}
