import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { isWarzoneEvidenceTarget } from "@/lib/video/warzone-evidence.shared";
import {
  eventUploadContextSchema,
  type EventUploadContext,
} from "@/lib/video/warzone-evidence.shared";

export class EventUploadContextError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EventUploadContextError";
  }
}

/**
 * Validate a typed event binding before a job/group is allocated.
 * Tenant-scoped: the occurrence must belong to the session alliance and the
 * board must belong to that occurrence. Only Warzone Duel occurrences are
 * bindable in this release — other families' upload UX is a later slice.
 */
export async function resolveEventUploadContext(params: {
  allianceId: string | null;
  scoreTarget: string;
  eventContext: unknown;
}): Promise<EventUploadContext | null> {
  const { allianceId, scoreTarget, eventContext } = params;
  const isWarzone = isWarzoneEvidenceTarget(scoreTarget);

  if (eventContext == null) {
    if (isWarzone) {
      throw new EventUploadContextError("event_context_required");
    }
    return null;
  }
  if (!isWarzone) {
    throw new EventUploadContextError("event_context_unsupported");
  }
  if (!allianceId) {
    throw new EventUploadContextError("alliance_required");
  }

  const parsed = eventUploadContextSchema.safeParse(eventContext);
  if (!parsed.success) {
    throw new EventUploadContextError("invalid_event_context");
  }

  const db = getDb();
  const [event] = await db
    .select({
      id: schema.hqEvents.id,
      eventFamily: schema.hqEvents.eventFamily,
      scoreTarget: schema.hqEvents.scoreTarget,
    })
    .from(schema.hqEvents)
    .where(
      and(
        eq(schema.hqEvents.id, parsed.data.eventId),
        eq(schema.hqEvents.allianceId, allianceId),
      ),
    )
    .limit(1);
  if (!event) {
    throw new EventUploadContextError("event_not_found");
  }
  if ((event.eventFamily ?? event.scoreTarget) !== "warzone-duel") {
    throw new EventUploadContextError("event_family_unsupported");
  }

  const [board] = await db
    .select({ id: schema.hqEventBoards.id })
    .from(schema.hqEventBoards)
    .where(
      and(
        eq(schema.hqEventBoards.id, parsed.data.boardId),
        eq(schema.hqEventBoards.hqEventId, event.id),
        eq(schema.hqEventBoards.allianceId, allianceId),
      ),
    )
    .limit(1);
  if (!board) {
    throw new EventUploadContextError("board_not_found");
  }

  return parsed.data;
}
