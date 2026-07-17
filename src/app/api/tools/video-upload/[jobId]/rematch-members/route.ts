import { NextResponse } from "next/server";

import { AllianceNotAshedLinkedError } from "@/lib/alliance/ashed-write-guard";
import { buildConnectHref } from "@/lib/connect/connect-return-path.shared";
import { getOrCreateSession } from "@/lib/session";
import { isAshedNotConnectedError } from "@/lib/video/errors";
import { rematchVideoJobMembers } from "@/lib/video/rematch-members";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";

type Props = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Props) {
  try {
    const session = await getOrCreateSession();
    const { jobId } = await params;

    const access = await resolveVideoJobAccess(jobId, session.id, "mutate");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }

    if (access.job.status === "complete" || access.job.status === "submitting") {
      return NextResponse.json(
        { error: "Cannot rematch members after scores have been submitted." },
        { status: 409 },
      );
    }

    const result = await rematchVideoJobMembers(jobId, {
      callerSessionId: session.id,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AllianceNotAshedLinkedError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 },
      );
    }
    if (isAshedNotConnectedError(error)) {
      const { jobId } = await params;
      const reviewPath = `/tools/video-upload/${jobId}/review`;
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          connectUrl: buildConnectHref(reviewPath),
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Rematch failed",
      },
      { status: 500 },
    );
  }
}
