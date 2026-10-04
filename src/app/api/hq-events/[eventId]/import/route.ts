import { NextResponse } from "next/server";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import { loadAshedConnectionForAllianceCapability } from "@/lib/ashed/load-ashed-connection.server";
import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import {
  AshedImportError,
  importAshedEventEvidence,
  linkAshedEvent,
  type AshedImportClassification,
} from "@/lib/hq-events/ashed-import.server";
import { EventEvidenceError } from "@/lib/hq-events/evidence-repository.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

type Props = { params: Promise<{ eventId: string }> };

function mappedError(error: unknown): NextResponse | null {
  if (error instanceof AshedImportError) {
    const status =
      error.code === "remote_id_linked_elsewhere" ? 409 : 400;
    return NextResponse.json({ error: error.code }, { status });
  }
  if (error instanceof EventEvidenceError) {
    const status =
      error.code === "event_not_found" || error.code === "board_not_found"
        ? 404
        : error.code === "request_conflict" ||
            error.code === "stale_evidence_version"
          ? 409
          : 400;
    return NextResponse.json({ error: error.code }, { status });
  }
  return null;
}

export async function POST(request: Request, { params }: Props) {
  try {
    const sessionOrError = await requireApiSession();
    if (sessionOrError instanceof NextResponse) return sessionOrError;
    const session = sessionOrError;

    const allianceId = resolveSessionAllianceId(session);
    if (!allianceId) {
      return NextResponse.json({ error: "alliance_required" }, { status: 400 });
    }
    const actor = {
      allianceId,
      hqUserId: session.hqUserId ?? null,
      sessionId: session.id,
    };
    const { eventId } = await params;
    const body = (await request.json()) as {
      action?: "link" | "import";
      remoteEventId?: string;
      requestId?: string;
      submitEntity?: string;
      classification?: "unconfirmed" | "real" | "legacy";
    };

    if (body.action === "link") {
      const denied = await requireSessionPermission(
        session.id,
        "hq:events:write",
      );
      if (denied) return denied;
      if (!body.remoteEventId) {
        return NextResponse.json(
          { error: "remote_event_id_required" },
          { status: 400 },
        );
      }
      const result = await linkAshedEvent(actor, {
        eventId,
        remoteEventId: body.remoteEventId,
      });
      return NextResponse.json(result);
    }

    if (body.action !== "import") {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }
    const denied = await requireSessionPermission(session.id, "scores:write");
    if (denied) return denied;
    if (!body.remoteEventId || !body.requestId || !body.submitEntity) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const classification: AshedImportClassification = {
      kind:
        body.classification === "real" || body.classification === "legacy"
          ? body.classification
          : "unconfirmed",
    };

    const connection = await loadAshedConnectionForAllianceCapability({
      sessionId: session.id,
      allianceId,
      capability: "data_management:write",
      delegatedAction: "hq_events.ashed_import",
    });
    if (!connection) {
      return NextResponse.json({ error: "ashed_not_connected" }, { status: 503 });
    }
    const ashedAllianceId = await getAshedAllianceIdIfLinked(allianceId);
    if (!ashedAllianceId) {
      return NextResponse.json(
        { error: "alliance_not_ashed_linked" },
        { status: 409 },
      );
    }

    const receipt = await importAshedEventEvidence(actor, connection, {
      eventId,
      remoteEventId: body.remoteEventId,
      requestId: body.requestId,
      submitEntity: body.submitEntity,
      classification,
    }, { ashedAllianceId });
    return NextResponse.json({ receipt });
  } catch (error) {
    const mapped = mappedError(error);
    if (mapped) return mapped;
    return NextResponse.json({ error: "import_failed" }, { status: 500 });
  }
}
