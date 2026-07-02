import { NextResponse } from "next/server";

import { getOrCreateSession } from "@/lib/session";
import { buildVideoProcessPreview } from "@/lib/video/video-process-preview.server";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;

    const access = await resolveVideoJobAccess(jobId, session.id, "read");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }

    const preview = await buildVideoProcessPreview({
      job: access.job,
      sessionId: session.id,
    });

    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load process preview",
      },
      { status: 500 },
    );
  }
}
