import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  LockedDayPaintBlockedError,
  TrainPastDateError,
} from "@/lib/trains/service";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";
import type { VsActor } from "@/lib/vs-performance/weekly-view.shared";

export function vsActorForSession(session: {
  id: string;
  hqUserId?: string | null;
  currentAllianceId?: string | null;
  allianceId?: string | null;
}): VsActor | NextResponse {
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json(
      { error: "forbidden", code: "forbidden" },
      { status: 403 },
    );
  }
  return {
    sessionId: session.id,
    hqUserId: session.hqUserId,
    allianceId,
  };
}

export function vsErrorResponse(error: unknown): NextResponse {
  if (error instanceof VsPerformanceError) {
    return NextResponse.json(
      { error: error.code, code: error.code },
      { status: error.status },
    );
  }
  if (
    error instanceof LockedDayPaintBlockedError ||
    error instanceof TrainPastDateError
  ) {
    return NextResponse.json(
      { error: "stale", code: "stale" },
      { status: 409 },
    );
  }
  if (error instanceof SyntaxError || error instanceof ZodError) {
    return NextResponse.json(
      { error: "invalid", code: "invalid" },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: "save", code: "save" }, { status: 500 });
}
