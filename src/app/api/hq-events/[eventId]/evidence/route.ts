import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import {
  commitReviewedEventEvidence,
  EventEvidenceError,
  loadEventEvidence,
  type EventObservationInput,
} from "@/lib/hq-events/evidence-repository.server";
import { syncEventResults } from "@/lib/hq-events/ashed-sync.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

type Props = { params: Promise<{ eventId: string }> };

function evidenceErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof EventEvidenceError)) return null;
  const status =
    error.code === "event_not_found" ||
    error.code === "board_not_found" ||
    error.code === "supersede_target_not_found" ||
    error.code === "retract_target_not_found"
      ? 404
      : error.code === "request_conflict" || error.code === "stale_evidence_version"
        ? 409
        : 400;
  return NextResponse.json({ error: error.code }, { status });
}

export async function GET(request: Request, { params }: Props) {
  try {
    const sessionOrError = await requireApiSession();
    if (sessionOrError instanceof NextResponse) return sessionOrError;
    const session = sessionOrError;
    const denied = await requireSessionPermission(session.id, "events:read");
    if (denied) return denied;

    const allianceId = resolveSessionAllianceId(session);
    if (!allianceId) {
      return NextResponse.json({ error: "alliance_required" }, { status: 400 });
    }

    const { eventId } = await params;
    const url = new URL(request.url);
    const evidence = await loadEventEvidence(
      {
        allianceId,
        hqUserId: session.hqUserId ?? null,
        sessionId: session.id,
      },
      {
        eventId,
        boardId: url.searchParams.get("boardId"),
        limit: url.searchParams.get("limit")
          ? Number(url.searchParams.get("limit"))
          : undefined,
        cursor: url.searchParams.get("cursor"),
      },
    );
    if (!evidence) {
      return NextResponse.json({ error: "event_not_found" }, { status: 404 });
    }
    return NextResponse.json(evidence);
  } catch {
    return NextResponse.json({ error: "evidence_load_failed" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Props) {
  try {
    const sessionOrError = await requireApiSession();
    if (sessionOrError instanceof NextResponse) return sessionOrError;
    const session = sessionOrError;
    const denied = await requireSessionPermission(session.id, "scores:write");
    if (denied) return denied;

    const allianceId = resolveSessionAllianceId(session);
    if (!allianceId) {
      return NextResponse.json({ error: "alliance_required" }, { status: 400 });
    }

    const { eventId } = await params;
    const body = (await request.json()) as {
      requestId?: string;
      sourceRef?: string;
      reviewedRevision?: number;
      boards?: {
        boardId: string;
        observations?: EventObservationInput[];
        retractsObservationIds?: string[];
      }[];
    };

    if (!body.requestId || !Array.isArray(body.boards) || body.boards.length === 0) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }

    const receipt = await commitReviewedEventEvidence(
      {
        allianceId,
        hqUserId: session.hqUserId ?? null,
        sessionId: session.id,
      },
      {
        eventId,
        requestId: body.requestId,
        sourceKind: "manual",
        sourceRef: body.sourceRef ?? null,
        reviewedRevision: body.reviewedRevision ?? null,
        boards: body.boards.map((board) => ({
          boardId: board.boardId,
          observations: board.observations ?? [],
          retractsObservationIds: board.retractsObservationIds ?? [],
        })),
      },
    );
    // Post-commit Ashed sync (create-only + conflicts). Runs outside the
    // commit transaction; failures are surfaced per item, never fatal.
    const sync = await syncEventResults(
      {
        allianceId,
        hqUserId: session.hqUserId ?? null,
        sessionId: session.id,
      },
      {
        eventId,
        boardIds: body.boards.map((board) => board.boardId),
      },
    ).catch(() => null);
    return NextResponse.json({ receipt, sync });
  } catch (error) {
    const mapped = evidenceErrorResponse(error);
    if (mapped) return mapped;
    return NextResponse.json(
      { error: "evidence_commit_failed" },
      { status: 500 },
    );
  }
}
