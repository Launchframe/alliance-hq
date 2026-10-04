import "server-only";

import { getDb } from "@/lib/db";
import { canViewTeamWork } from "./work-routing.shared";
import { reconcileTeamWorkTx } from "./work-service.server";

export async function canReadTeamWorkInbox(input: { allianceId: string; hqUserId: string; permissions: Set<string>; personal?: boolean }) {
  return getDb().transaction(async (tx) => {
    const result = await reconcileTeamWorkTx(tx, input.allianceId);
    const recipient = result.recipients.find((row) => row.id === input.hqUserId && row.allianceId === input.allianceId);
    if (!recipient) return false;
    const viewer = { ...recipient, permissions: recipient.permissions.filter((permission) => input.permissions.has(permission)) };
    return result.items.some((item) => canViewTeamWork(item, viewer, input.personal ?? false));
  });
}
