import { NextResponse } from "next/server";

import { archiveVideoJobSource } from "@/lib/video/archive-job";

export const maxDuration = 300;
export const runtime = "nodejs";

type Props = {
  params: Promise<{ jobId: string }>;
};

function authorize(request: Request): boolean {
  const secret = process.env.VIDEO_WORKER_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function POST(request: Request, { params }: Props) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;

  try {
    await archiveVideoJobSource(jobId);
    return NextResponse.json({ ok: true, jobId });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Archive failed",
      },
      { status: 500 },
    );
  }
}
