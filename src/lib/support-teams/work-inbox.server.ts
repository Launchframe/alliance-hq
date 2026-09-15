import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { canViewTeamWork } from "./work-routing.shared";
import { loadWorkContext } from "./work-context.server";

export async function canReadTeamWorkInbox(input: { allianceId: string; hqUserId: string; permissions: Set<string>; personal?: boolean }) {
  return getDb().transaction(async (tx) => {
    const items = await tx.select().from(schema.teamWorkItems).where(and(eq(schema.teamWorkItems.allianceId, input.allianceId), eq(schema.teamWorkItems.open, true)));
    const context = await loadWorkContext(tx, input.allianceId);
    const recipient = context.recipients.find((row) => row.id === input.hqUserId && row.allianceId === input.allianceId);
    if (!recipient) return false;
    const viewer = { ...recipient, permissions: recipient.permissions.filter((permission) => input.permissions.has(permission)) };
    return items.some((item) => canViewTeamWork(item, viewer, input.personal ?? false));
  });
}
