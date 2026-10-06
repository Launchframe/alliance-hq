import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import {
  confirmEventReadiness,
  EventEvidenceError,
} from "@/lib/hq-events/evidence-repository.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

type Props = { params: Promise<{ eventId: string }> };

export async function POST(request: Request, { params }: Props) {
  try {
    const sessionOrError = await requireApiSession();
    if (sessionOrError instanceof NextResponse) return sessionOrError;
    const session = sessionOrError;
    const denied = await requireSessionPermission(session.id, "trains:write");
    if (denied) return denied;

    const allianceId = resolveSessionAllianceId(session);
    if (!allianceId) {
      return NextResponse.json({ error: "alliance_required" }, { status: 400 });
    }

    const { eventId } = await params;
    const body = (await request.json()) as {
      boardId?: string;
      expectedEvidenceVersion?: number;
      action?: "mark" | "invalidate";
      readySources?: string[];
      emptyConfirmed?: boolean;
    };
    if (
      !body.boardId ||
      (body.action !== "mark" && body.action !== "invalidate") ||
      (body.action === "mark" &&
        typeof body.expectedEvidenceVersion !== "number")
    ) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const result = await confirmEventReadiness(
      {
        allianceId,
        hqUserId: session.hqUserId ?? null,
        sessionId: session.id,
      },
      {
        eventId,
        boardId: body.boardId,
        expectedEvidenceVersion: body.expectedEvidenceVersion ?? -1,
        action: body.action,
        readySources: body.readySources ?? null,
        emptyConfirmed: body.emptyConfirmed === true,
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof EventEvidenceError) {
      const status =
        error.code === "event_not_found" || error.code === "board_not_found"
          ? 404
          : error.code === "stale_evidence_version" ||
              error.code === "import_incomplete"
            ? 409
            : 400;
      return NextResponse.json({ error: error.code }, { status });
    }
    return NextResponse.json({ error: "readiness_failed" }, { status: 500 });
  }
}
