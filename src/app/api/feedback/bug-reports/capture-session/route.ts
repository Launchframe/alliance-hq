import { NextResponse } from "next/server";

import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import { createBugReportCaptureSession } from "@/lib/feedback/bug-report-capture-session";
import { requireApiSession } from "@/lib/session";

export async function POST() {
  try {
    const sessionOrError = await requireApiSession();

    if (sessionOrError instanceof NextResponse) return sessionOrError;

    const session = sessionOrError;
    if (!session.hqUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = createBugReportCaptureSession(session.hqUserId);
    return NextResponse.json(payload, { status: 201 });
  } catch {
    return feedbackErrorResponse("Capture session failed");
  }
}
