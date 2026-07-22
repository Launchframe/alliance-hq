import "server-only";

import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  assertCommanderReadAccess,
  CommanderAccessError,
  loadAllianceCommander,
  resolveCommanderSessionContext,
} from "@/lib/members/commander-access.server";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";

/**
 * Launch: members:write (officer). Flip to members:read to open peer gifting to all members.
 */
export const STORE_BRICK_GIFT_PERMISSION = "members:write";

const LAST_WAR_STORE_BASE =
  "https://lastwar-us-platform.lastwar.com/pay/v1/officeGoldBrickPaymentLoginServlet";

export class CommanderDonationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "CommanderDonationError";
    this.status = status;
    this.code = code;
  }
}

export async function assertCanGiftStoreBricks(
  sessionId: string,
  allianceId: string,
): Promise<void> {
  await assertCommanderReadAccess(sessionId, allianceId);
  const allowed = await sessionHasPermissionForAlliance(
    sessionId,
    allianceId,
    STORE_BRICK_GIFT_PERMISSION,
  );
  if (!allowed) {
    throw new CommanderDonationError("Forbidden.", 403, "forbidden");
  }
}

export async function sessionCanGiftStoreBricks(
  sessionId: string,
  allianceId: string,
): Promise<boolean> {
  try {
    await assertCanGiftStoreBricks(sessionId, allianceId);
    return true;
  } catch {
    return false;
  }
}

export function getLastWarStoreLoginToken(): string | null {
  const token = process.env.LAST_WAR_STORE_LOGIN_TOKEN?.trim();
  return token && token.length > 0 ? token : null;
}

/** Build Last War office gold-brick URL. Never log the result (contains UID ± token). */
export function buildLastWarStoreUrl(uid: string): string | null {
  const token = getLastWarStoreLoginToken();
  if (!token) return null;
  const trimmed = uid.trim();
  if (!trimmed) return null;
  const params = new URLSearchParams({
    uid: trimmed,
    loginToken: token,
    website_platform: "new_office",
  });
  return `${LAST_WAR_STORE_BASE}?${params.toString()}`;
}

async function resolveRecipientGameUid(
  allianceId: string,
  ashedMemberId: string,
): Promise<string | null> {
  const member = await loadAllianceCommander(allianceId, ashedMemberId);
  const fromRow = member?.gameUid?.trim();
  if (fromRow) return fromRow;

  const db = getDb();

  const [hqLink] = await db
    .select({ gameUid: schema.hqMemberLinks.gameUid })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  if (hqLink?.gameUid?.trim()) return hqLink.gameUid.trim();

  const [discordLink] = await db
    .select({ gameUid: schema.discordMemberLinks.gameUid })
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.allianceId, allianceId),
        eq(schema.discordMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  const fromDiscord = discordLink?.gameUid?.trim();
  return fromDiscord || null;
}

async function viewerLinkedAshedMemberIds(
  allianceId: string,
  hqUserId: string,
): Promise<Set<string>> {
  const db = getDb();
  const links = await db
    .select({ ashedMemberId: schema.hqMemberLinks.ashedMemberId })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
      ),
    );
  return new Set(links.map((l) => l.ashedMemberId));
}

export async function assertNotSelfGift(input: {
  allianceId: string;
  hqUserId: string;
  recipientAshedMemberId: string;
}): Promise<void> {
  const own = await viewerLinkedAshedMemberIds(input.allianceId, input.hqUserId);
  if (own.has(input.recipientAshedMemberId)) {
    throw new CommanderDonationError(
      "Cannot gift to your own Commander.",
      422,
      "self_gift_blocked",
    );
  }
}

export async function resolveCommanderDonationStoreUrl(
  sessionId: string,
  ashedMemberId: string,
): Promise<{ url: string }> {
  const { allianceId, hqUserId } = await resolveCommanderSessionContext(sessionId);
  await assertCanGiftStoreBricks(sessionId, allianceId);
  if (!hqUserId) {
    throw new CommanderDonationError("HQ account required.", 401, "hq_user_required");
  }

  const member = await loadAllianceCommander(allianceId, ashedMemberId);
  if (!member) {
    throw new CommanderDonationError("Commander not found.", 404, "not_found");
  }

  await assertNotSelfGift({
    allianceId,
    hqUserId,
    recipientAshedMemberId: ashedMemberId,
  });

  const uid = await resolveRecipientGameUid(allianceId, ashedMemberId);
  if (!uid) {
    throw new CommanderDonationError(
      "Recipient UID unavailable.",
      422,
      "recipient_uid_unavailable",
    );
  }

  const url = buildLastWarStoreUrl(uid);
  if (!url) {
    throw new CommanderDonationError(
      "Store donations aren’t configured.",
      422,
      "donation_store_unavailable",
    );
  }

  return { url };
}

export async function createDonationReceipt(input: {
  sessionId: string;
  ashedMemberId: string;
  amountCents: number;
  purchasedAt: Date;
  note?: string | null;
}): Promise<{ id: string }> {
  const { allianceId, hqUserId } = await resolveCommanderSessionContext(
    input.sessionId,
  );
  await assertCanGiftStoreBricks(input.sessionId, allianceId);
  if (!hqUserId) {
    throw new CommanderDonationError("HQ account required.", 401, "hq_user_required");
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new CommanderDonationError("Invalid amount.", 400, "invalid_amount");
  }

  const member = await loadAllianceCommander(allianceId, input.ashedMemberId);
  if (!member) {
    throw new CommanderDonationError("Commander not found.", 404, "not_found");
  }

  await assertNotSelfGift({
    allianceId,
    hqUserId,
    recipientAshedMemberId: input.ashedMemberId,
  });

  const id = nanoid(16);
  const db = getDb();
  await db.insert(schema.commanderStoreDonationReceipts).values({
    id,
    allianceId,
    donorHqUserId: hqUserId,
    recipientAshedMemberId: input.ashedMemberId,
    recipientDisplayName: member.currentName,
    amountCents: input.amountCents,
    currency: "USD",
    purchasedAt: input.purchasedAt,
    note: input.note?.trim() || null,
  });

  return { id };
}

export async function softDeleteDonationReceipt(input: {
  sessionId: string;
  receiptId: string;
}): Promise<void> {
  const { allianceId, hqUserId } = await resolveCommanderSessionContext(
    input.sessionId,
  );
  if (!hqUserId) {
    throw new CommanderDonationError("HQ account required.", 401, "hq_user_required");
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.commanderStoreDonationReceipts)
    .where(
      and(
        eq(schema.commanderStoreDonationReceipts.id, input.receiptId),
        eq(schema.commanderStoreDonationReceipts.allianceId, allianceId),
        isNull(schema.commanderStoreDonationReceipts.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    throw new CommanderDonationError("Receipt not found.", 404, "not_found");
  }

  const isOfficer = await sessionHasPermissionForAlliance(
    input.sessionId,
    allianceId,
    "members:write",
  );
  if (row.donorHqUserId !== hqUserId && !isOfficer) {
    throw new CommanderDonationError("Forbidden.", 403, "forbidden");
  }

  await db
    .update(schema.commanderStoreDonationReceipts)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.commanderStoreDonationReceipts.id, input.receiptId));
}

export type StoreSpendScope = "me" | "alliance";

export async function listStoreSpend(input: {
  sessionId: string;
  from: Date;
  to: Date;
  scope: StoreSpendScope;
}): Promise<{
  totalCents: number;
  currency: string;
  from: string;
  to: string;
  receipts: Array<{
    id: string;
    purchasedAt: string;
    amountCents: number;
    recipientDisplayName: string | null;
    donorDisplayName: string | null;
    note: string | null;
  }>;
}> {
  const { allianceId, hqUserId } = await resolveCommanderSessionContext(
    input.sessionId,
  );
  if (!hqUserId) {
    throw new CommanderDonationError("HQ account required.", 401, "hq_user_required");
  }

  if (input.scope === "alliance") {
    const allowed = await sessionHasPermissionForAlliance(
      input.sessionId,
      allianceId,
      "members:write",
    );
    if (!allowed) {
      throw new CommanderDonationError("Forbidden.", 403, "forbidden");
    }
  } else {
    await assertCanGiftStoreBricks(input.sessionId, allianceId);
  }

  const db = getDb();
  const conditions = [
    eq(schema.commanderStoreDonationReceipts.allianceId, allianceId),
    isNull(schema.commanderStoreDonationReceipts.deletedAt),
    gte(schema.commanderStoreDonationReceipts.purchasedAt, input.from),
    lte(schema.commanderStoreDonationReceipts.purchasedAt, input.to),
  ];
  if (input.scope === "me") {
    conditions.push(
      eq(schema.commanderStoreDonationReceipts.donorHqUserId, hqUserId),
    );
  }

  const [sumRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${schema.commanderStoreDonationReceipts.amountCents}), 0)`,
    })
    .from(schema.commanderStoreDonationReceipts)
    .where(and(...conditions));

  const rows = await db
    .select({
      id: schema.commanderStoreDonationReceipts.id,
      purchasedAt: schema.commanderStoreDonationReceipts.purchasedAt,
      amountCents: schema.commanderStoreDonationReceipts.amountCents,
      recipientDisplayName:
        schema.commanderStoreDonationReceipts.recipientDisplayName,
      note: schema.commanderStoreDonationReceipts.note,
      donorDisplayName: schema.hqUsers.displayName,
    })
    .from(schema.commanderStoreDonationReceipts)
    .leftJoin(
      schema.hqUsers,
      eq(
        schema.commanderStoreDonationReceipts.donorHqUserId,
        schema.hqUsers.id,
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.commanderStoreDonationReceipts.purchasedAt))
    .limit(200);

  return {
    totalCents: Number(sumRow?.total ?? 0),
    currency: "USD",
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    receipts: rows.map((row) => ({
      id: row.id,
      purchasedAt: row.purchasedAt.toISOString(),
      amountCents: row.amountCents,
      recipientDisplayName: row.recipientDisplayName,
      donorDisplayName:
        input.scope === "alliance" ? row.donorDisplayName ?? null : null,
      note: row.note,
    })),
  };
}

function tipCodeHint(code: string): string {
  return code.length <= 4 ? code : `…${code.slice(-4)}`;
}

export async function createOrRotateTipLink(input: {
  sessionId: string;
}): Promise<{
  code: string;
  shortPath: string;
  badgePngPath: string;
  revokedPrevious: boolean;
}> {
  const { allianceId, hqUserId } = await resolveCommanderSessionContext(
    input.sessionId,
  );
  await assertCanGiftStoreBricks(input.sessionId, allianceId);
  if (!hqUserId) {
    throw new CommanderDonationError("HQ account required.", 401, "hq_user_required");
  }

  const db = getDb();
  const [link] = await db
    .select({
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
    })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
      ),
    )
    .limit(1);

  if (!link) {
    throw new CommanderDonationError(
      "Link your Commander before creating a tip link.",
      422,
      "commander_not_linked",
    );
  }

  const uid = await resolveRecipientGameUid(allianceId, link.ashedMemberId);
  if (!uid) {
    throw new CommanderDonationError(
      "Recipient UID unavailable.",
      422,
      "recipient_uid_unavailable",
    );
  }

  const member = await loadAllianceCommander(allianceId, link.ashedMemberId);
  const now = new Date();

  const existing = await db
    .select({ id: schema.commanderStoreTipLinks.id })
    .from(schema.commanderStoreTipLinks)
    .where(
      and(
        eq(schema.commanderStoreTipLinks.allianceId, allianceId),
        eq(schema.commanderStoreTipLinks.ashedMemberId, link.ashedMemberId),
        isNull(schema.commanderStoreTipLinks.revokedAt),
      ),
    );

  let revokedPrevious = false;
  if (existing.length > 0) {
    revokedPrevious = true;
    await db
      .update(schema.commanderStoreTipLinks)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.commanderStoreTipLinks.allianceId, allianceId),
          eq(schema.commanderStoreTipLinks.ashedMemberId, link.ashedMemberId),
          isNull(schema.commanderStoreTipLinks.revokedAt),
        ),
      );
  }

  const code = nanoid(12);
  const id = nanoid(16);
  await db.insert(schema.commanderStoreTipLinks).values({
    id,
    allianceId,
    ashedMemberId: link.ashedMemberId,
    ownerHqUserId: hqUserId,
    code,
    codeHint: tipCodeHint(code),
    displayNameSnapshot: member?.currentName ?? null,
  });

  return {
    code,
    shortPath: `/b/${code}`,
    badgePngPath: `/api/public/store-tip/${code}/badge`,
    revokedPrevious,
  };
}

export async function getActiveTipLinkForSession(sessionId: string): Promise<{
  code: string;
  shortPath: string;
  badgePngPath: string;
  codeHint: string;
} | null> {
  const { allianceId, hqUserId } = await resolveCommanderSessionContext(sessionId);
  if (!hqUserId) return null;

  const canGift = await sessionCanGiftStoreBricks(sessionId, allianceId);
  if (!canGift) return null;

  const db = getDb();
  const [link] = await db
    .select({
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
    })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
      ),
    )
    .limit(1);
  if (!link) return null;

  const [tip] = await db
    .select()
    .from(schema.commanderStoreTipLinks)
    .where(
      and(
        eq(schema.commanderStoreTipLinks.allianceId, allianceId),
        eq(schema.commanderStoreTipLinks.ashedMemberId, link.ashedMemberId),
        isNull(schema.commanderStoreTipLinks.revokedAt),
      ),
    )
    .limit(1);

  if (!tip) return null;
  return {
    code: tip.code,
    shortPath: `/b/${tip.code}`,
    badgePngPath: `/api/public/store-tip/${tip.code}/badge`,
    codeHint: tip.codeHint,
  };
}

export async function revokeActiveTipLink(sessionId: string): Promise<void> {
  const { allianceId, hqUserId } = await resolveCommanderSessionContext(sessionId);
  await assertCanGiftStoreBricks(sessionId, allianceId);
  if (!hqUserId) {
    throw new CommanderDonationError("HQ account required.", 401, "hq_user_required");
  }

  const db = getDb();
  const [link] = await db
    .select({ ashedMemberId: schema.hqMemberLinks.ashedMemberId })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
      ),
    )
    .limit(1);
  if (!link) {
    throw new CommanderDonationError("Commander not linked.", 422, "commander_not_linked");
  }

  await db
    .update(schema.commanderStoreTipLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.commanderStoreTipLinks.allianceId, allianceId),
        eq(schema.commanderStoreTipLinks.ashedMemberId, link.ashedMemberId),
        isNull(schema.commanderStoreTipLinks.revokedAt),
      ),
    );
}

export async function loadPublicTipLink(code: string): Promise<{
  code: string;
  displayName: string;
  allianceTag: string | null;
  ashedMemberId: string;
  allianceId: string;
} | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const db = getDb();
  const [row] = await db
    .select({
      code: schema.commanderStoreTipLinks.code,
      displayNameSnapshot: schema.commanderStoreTipLinks.displayNameSnapshot,
      ashedMemberId: schema.commanderStoreTipLinks.ashedMemberId,
      allianceId: schema.commanderStoreTipLinks.allianceId,
      allianceTag: schema.alliances.tag,
      memberName: schema.allianceMembers.currentName,
    })
    .from(schema.commanderStoreTipLinks)
    .innerJoin(
      schema.alliances,
      eq(schema.commanderStoreTipLinks.allianceId, schema.alliances.id),
    )
    .leftJoin(
      schema.allianceMembers,
      and(
        eq(schema.allianceMembers.allianceId, schema.commanderStoreTipLinks.allianceId),
        eq(
          schema.allianceMembers.ashedMemberId,
          schema.commanderStoreTipLinks.ashedMemberId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.commanderStoreTipLinks.code, trimmed),
        isNull(schema.commanderStoreTipLinks.revokedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  return {
    code: row.code,
    displayName:
      row.memberName?.trim() ||
      row.displayNameSnapshot?.trim() ||
      "Commander",
    allianceTag: row.allianceTag,
    ashedMemberId: row.ashedMemberId,
    allianceId: row.allianceId,
  };
}

export async function resolvePublicTipStoreUrl(code: string): Promise<{ url: string }> {
  const tip = await loadPublicTipLink(code);
  if (!tip) {
    throw new CommanderDonationError("Tip link unavailable.", 404, "not_found");
  }
  const uid = await resolveRecipientGameUid(tip.allianceId, tip.ashedMemberId);
  if (!uid) {
    throw new CommanderDonationError(
      "Recipient UID unavailable.",
      422,
      "recipient_uid_unavailable",
    );
  }
  const url = buildLastWarStoreUrl(uid);
  if (!url) {
    throw new CommanderDonationError(
      "Store donations aren’t configured.",
      422,
      "donation_store_unavailable",
    );
  }
  return { url };
}

export { CommanderAccessError };
