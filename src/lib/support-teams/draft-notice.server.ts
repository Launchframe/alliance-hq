import "server-only";

import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { draftKey } from "./draft.shared";
import { readField } from "./policy.shared";
import type { SupportTransaction } from "./repository.server";
import type { SupportBoard, SupportEvent } from "./types.shared";

export async function persistDraftNotice(db: SupportTransaction, board: SupportBoard, event: SupportEvent, history: SupportEvent[]) {
  const touchedDrafts = new Set([event.context.draftId, ...history.filter((item) => event.reverses.includes(item.id)).map((item) => item.context.draftId)].filter((id): id is string => Boolean(id)));
  for (const id of touchedDrafts) {
    if (!["scheduleDraft", "extendDraft", "publishDraft", "cancelDraft", "undo"].includes(event.kind)) continue;
    const resourceId = `support-team-draft:${id}`;
    await db.update(schema.inboxReminderItems).set({ active: 0 }).where(and(eq(schema.inboxReminderItems.allianceId, board.allianceId), eq(schema.inboxReminderItems.kind, "support_team_draft"), eq(schema.inboxReminderItems.resourceId, resourceId)));
    const active = board.construction?.kind === "draft" && board.construction.id === id;
    if (!active) continue;
    await db.insert(schema.inboxReminderItems).values({ id: `draft-notice:${event.id}:${id}`, allianceId: board.allianceId, kind: "support_team_draft", title: "supportTeams.draft.title", body: String(readField(board, draftKey(id, "endsAt"))), scoreTarget: String(readField(board, draftKey(id, "startsAt"))), href: `/support-teams?draft=${encodeURIComponent(id)}`, requiredPermission: "support_teams:read", resourceId, active: 1 }).onConflictDoNothing();
  }
}
