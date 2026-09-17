import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  MEMBER_ROLE_DEESCALATE_INBOX_KIND,
  MEMBER_ROLE_ESCALATE_INBOX_KIND,
  memberRoleNudgeHref,
  type MemberRoleNudgeKind,
} from "@/lib/member-role-nudges/types.shared";

function inboxKindForNudge(kind: MemberRoleNudgeKind): string {
  return kind === "deescalate"
    ? MEMBER_ROLE_DEESCALATE_INBOX_KIND
    : MEMBER_ROLE_ESCALATE_INBOX_KIND;
}

export async function materializeMemberRoleNudgeInboxItem(input: {
  allianceId: string;
  nudgeId: string;
  kind: MemberRoleNudgeKind;
  memberName: string;
  /** Owner-only de-escalate when alliance owner is an HQ user. */
  ownerOnly?: boolean;
}): Promise<string> {
  const db = getDb();
  const kind = inboxKindForNudge(input.kind);
  const itemId = nanoid(16);

  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.allianceId, input.allianceId),
        eq(schema.inboxReminderItems.kind, kind),
        eq(schema.inboxReminderItems.resourceId, input.nudgeId),
      ),
    );

  await db.insert(schema.inboxReminderItems).values({
    id: itemId,
    allianceId: input.allianceId,
    kind,
    title: input.memberName,
    body: null,
    scoreTarget: input.memberName,
    href: memberRoleNudgeHref(input.nudgeId),
    // Escalate: trains:write reaches officers+. De-escalate owner-only uses
    // alliance:admin; otherwise trains:write for the officer pool.
    requiredPermission:
      input.kind === "deescalate" && input.ownerOnly
        ? "alliance:admin"
        : "trains:write",
    active: 1,
    resourceId: input.nudgeId,
  });

  return itemId;
}

export async function satisfyMemberRoleNudgeInboxItem(
  nudgeId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.inboxReminderItems)
    .set({ active: 0 })
    .where(
      and(
        eq(schema.inboxReminderItems.resourceId, nudgeId),
        eq(schema.inboxReminderItems.active, 1),
      ),
    );
}
