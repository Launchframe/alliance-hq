import { NextResponse } from "next/server";

import { getOrCreateSession } from "@/lib/session";
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

    const result = await rematchVideoJobMembers(jobId);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Rematch failed",
      },
      { status: 500 },
    );
  }
}
