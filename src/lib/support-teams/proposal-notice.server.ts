import "server-only";

import { and, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import { fieldVersion, boardKey, readField } from "./policy.shared";
import { proposalIds, proposalKey } from "./proposal.shared";
import type { SupportTransaction } from "./repository.server";
import type { SupportBoard, SupportEvent } from "./types.shared";

export async function persistProposalNotice(db: SupportTransaction, board: SupportBoard, event: SupportEvent) {
  if (!event.context.proposalId && event.kind !== "undo" && event.kind !== "publishDraft") return;
  await db.update(schema.inboxReminderItems).set({ active: 0 }).where(and(eq(schema.inboxReminderItems.allianceId, board.allianceId), eq(schema.inboxReminderItems.kind, "support_team_proposal")));
  for (const id of proposalIds(board)) {
    if (readField(board, proposalKey(id, "status")) !== "submitted" || readField(board, proposalKey(id, "basePublishedVersion")) !== fieldVersion(board, boardKey(board, "published"))) continue;
    await db.insert(schema.inboxReminderItems).values({ id: `proposal-notice:${event.id}:${id}`, allianceId: board.allianceId, kind: "support_team_proposal", title: "supportTeams.proposals.title", body: null, href: `/support-teams?proposal=${encodeURIComponent(id)}`, requiredPermission: "support_teams:read", resourceId: `support-team-proposal:${id}`, active: 1 }).onConflictDoNothing();
  }
}
