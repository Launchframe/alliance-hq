import "server-only";

import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { LinkPendingState } from "@/lib/vr/types";

const PENDING_TTL_MS = 30 * 60 * 1000;

function parseLinkPending(value: unknown): LinkPendingState | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.kind === "link_walkthrough" && typeof r.step === "number") {
    return { kind: "link_walkthrough", step: r.step };
  }
  if (r.kind === "link_fuzzy_pick" && Array.isArray(r.candidates)) {
    return {
      kind: "link_fuzzy_pick",
      candidates: r.candidates as Array<{ memberId: string; name: string }>,
      gameUid: String(r.gameUid),
      gameUserName: String(r.gameUserName),
      reportedName: String(r.reportedName),
      ...(typeof r.gameUserLevel === "number"
        ? { gameUserLevel: r.gameUserLevel }
        : {}),
    };
  }
  return null;
}

export async function getHqMemberLinkForUser(
  allianceId: string,
  hqUserId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getHqMemberLinkByAllianceAndMember(
  allianceId: string,
  ashedMemberId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function sessionHasHqMemberLink(
  allianceId: string,
  hqUserId: string,
): Promise<boolean> {
  const link = await getHqMemberLinkForUser(allianceId, hqUserId);
  return link != null;
}

export type LinkHqMemberResult =
  | { ok: true; link: typeof schema.hqMemberLinks.$inferSelect; mode: "created" | "updated" }
  | { ok: false; reason: "member_linked_to_other_user" };

export async function linkHqMember(input: {
  allianceId: string;
  hqUserId: string;
  ashedMemberId: string;
  memberDisplayName?: string | null;
  gameUid: string;
}): Promise<LinkHqMemberResult> {
  const db = getDb();
  const now = new Date();

  const existingMemberLink = await getHqMemberLinkByAllianceAndMember(
    input.allianceId,
    input.ashedMemberId,
  );
  if (
    existingMemberLink &&
    existingMemberLink.hqUserId !== input.hqUserId
  ) {
    return { ok: false, reason: "member_linked_to_other_user" };
  }

  const existingUserLink = await getHqMemberLinkForUser(
    input.allianceId,
    input.hqUserId,
  );

  if (existingUserLink) {
    const [row] = await db
      .update(schema.hqMemberLinks)
      .set({
        ashedMemberId: input.ashedMemberId,
        memberDisplayName: input.memberDisplayName ?? null,
        gameUid: input.gameUid,
        updatedAt: now,
      })
      .where(eq(schema.hqMemberLinks.id, existingUserLink.id))
      .returning();
    return { ok: true, link: row!, mode: "updated" };
  }

  const [row] = await db
    .insert(schema.hqMemberLinks)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      ashedMemberId: input.ashedMemberId,
      memberDisplayName: input.memberDisplayName ?? null,
      gameUid: input.gameUid,
      linkedAt: now,
      updatedAt: now,
    })
    .returning();

  return { ok: true, link: row!, mode: "created" };
}

export async function getHqMemberLinkPending(
  allianceId: string,
  hqUserId: string,
): Promise<{ allianceId: string; pending: LinkPendingState } | null> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select()
    .from(schema.hqMemberLinkPending)
    .where(
      and(
        eq(schema.hqMemberLinkPending.allianceId, allianceId),
        eq(schema.hqMemberLinkPending.hqUserId, hqUserId),
        gt(schema.hqMemberLinkPending.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) {
    await db
      .delete(schema.hqMemberLinkPending)
      .where(
        and(
          eq(schema.hqMemberLinkPending.allianceId, allianceId),
          eq(schema.hqMemberLinkPending.hqUserId, hqUserId),
        ),
      );
    return null;
  }

  const pending = parseLinkPending(row.pendingJson);
  if (!pending) {
    await saveHqMemberLinkPending(allianceId, hqUserId, null);
    return null;
  }

  return { allianceId: row.allianceId, pending };
}

export async function saveHqMemberLinkPending(
  allianceId: string,
  hqUserId: string,
  pending: LinkPendingState | null,
): Promise<void> {
  const db = getDb();
  if (!pending) {
    await db
      .delete(schema.hqMemberLinkPending)
      .where(
        and(
          eq(schema.hqMemberLinkPending.allianceId, allianceId),
          eq(schema.hqMemberLinkPending.hqUserId, hqUserId),
        ),
      );
    return;
  }

  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);
  await db
    .insert(schema.hqMemberLinkPending)
    .values({
      allianceId,
      hqUserId,
      pendingJson: pending,
      expiresAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.hqMemberLinkPending.allianceId,
        schema.hqMemberLinkPending.hqUserId,
      ],
      set: {
        pendingJson: pending,
        expiresAt,
        updatedAt: new Date(),
      },
    });
}

export async function syncPrimaryGameUidFromHqMemberLink(
  hqUserId: string,
  gameUid: string,
): Promise<void> {
  const trimmed = gameUid.trim();
  if (!trimmed) return;

  const db = getDb();
  await db
    .update(schema.hqUsers)
    .set({ primaryGameUid: trimmed, updatedAt: new Date() })
    .where(eq(schema.hqUsers.id, hqUserId));
}
