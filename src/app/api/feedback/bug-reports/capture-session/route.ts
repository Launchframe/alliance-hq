import { NextResponse } from "next/server";

import { createBugReportCaptureSession } from "@/lib/feedback/bug-report-capture-session";
import { getOrCreateSession } from "@/lib/session";

export async function POST() {
  try {
    const session = await getOrCreateSession();
    if (!session.hqUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = createBugReportCaptureSession(session.hqUserId);
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Capture session failed",
      },
      { status: 500 },
    );
  }
}
