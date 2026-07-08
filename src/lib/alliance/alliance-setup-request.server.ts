import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { emailPlatformMaintainers } from "@/lib/ops/platform-maintainer-alert.server";
import {
  listHqAlliancesByTag,
  resolveAllianceByTag,
} from "@/lib/vr/resolve-alliance-tag";
import { discordAppBaseUrl } from "@/lib/vr/bot-user-context";
import { isTagEligible } from "@/lib/vr/bot-setup";

export type AllianceSetupRequestStatus = "open" | "fulfilled" | "dismissed";

export type AllianceSetupRequestView = {
  id: string;
  tag: string;
  allianceName: string;
  gameServerNumber: number;
  requesterHqUserId: string;
  requesterEmail: string | null;
  discordUserId: string | null;
  status: AllianceSetupRequestStatus;
  fulfilledAllianceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AllianceSetupStatus = {
  allianceReady: boolean;
  allianceId?: string;
  setupRequest?: {
    id: string;
    status: AllianceSetupRequestStatus;
    tag: string;
    allianceName: string;
    gameServerNumber: number;
  };
};

function normalizeTag(tag: string): string {
  return tag.trim();
}

function normalizeTagKey(tag: string): string {
  return normalizeTag(tag).toLowerCase();
}

function mapSetupRequestRow(
  row: typeof schema.hqAllianceSetupRequests.$inferSelect,
): AllianceSetupRequestView {
  return {
    id: row.id,
    tag: row.tag,
    allianceName: row.allianceName,
    gameServerNumber: row.gameServerNumber,
    requesterHqUserId: row.requesterHqUserId,
    requesterEmail: row.requesterEmail,
    discordUserId: row.discordUserId,
    status: row.status as AllianceSetupRequestStatus,
    fulfilledAllianceId: row.fulfilledAllianceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function resolveAllianceIdForTag(input: {
  tag: string;
  discordUserId?: string;
}): Promise<string | null> {
  const resolved = await resolveAllianceByTag(input.tag, {
    discordUserId: input.discordUserId,
  });
  if (resolved.ok) {
    return resolved.alliance.id;
  }

  const candidates = await listHqAlliancesByTag(input.tag);
  if (candidates.length === 1) {
    return candidates[0]!.id;
  }

  return null;
}

export async function getAllianceSetupStatusForTag(input: {
  tag: string;
  discordUserId?: string;
}): Promise<AllianceSetupStatus> {
  const tag = normalizeTag(input.tag);
  if (!tag) {
    return { allianceReady: false };
  }

  const allianceId = await resolveAllianceIdForTag(input);
  if (allianceId) {
    return { allianceReady: true, allianceId };
  }

  const db = getDb();
  const [openRequest] = await db
    .select()
    .from(schema.hqAllianceSetupRequests)
    .where(
      and(
        eq(schema.hqAllianceSetupRequests.status, "open"),
        sql`lower(${schema.hqAllianceSetupRequests.tag}) = ${normalizeTagKey(tag)}`,
      ),
    )
    .orderBy(desc(schema.hqAllianceSetupRequests.createdAt))
    .limit(1);

  if (!openRequest) {
    return { allianceReady: false };
  }

  return {
    allianceReady: false,
    setupRequest: {
      id: openRequest.id,
      status: openRequest.status as AllianceSetupRequestStatus,
      tag: openRequest.tag,
      allianceName: openRequest.allianceName,
      gameServerNumber: openRequest.gameServerNumber,
    },
  };
}

export type CreateAllianceSetupRequestInput = {
  tag: string;
  allianceName: string;
  gameServerNumber: number;
  requesterHqUserId: string;
  requesterEmail?: string | null;
  discordUserId?: string | null;
};

export type CreateAllianceSetupRequestResult =
  | {
      ok: true;
      created: boolean;
      allianceReady: true;
      allianceId: string;
    }
  | {
      ok: true;
      created: boolean;
      allianceReady: false;
      setupRequest: AllianceSetupRequestView;
    }
  | {
      ok: false;
      code:
        | "tag_required"
        | "name_required"
        | "invalid_server"
        | "tag_not_eligible"
        | "provision_request_open";
    };

export async function createAllianceSetupRequest(
  input: CreateAllianceSetupRequestInput,
): Promise<CreateAllianceSetupRequestResult> {
  const tag = normalizeTag(input.tag);
  const allianceName = input.allianceName.trim();
  const gameServerNumber = Math.floor(input.gameServerNumber);

  if (!tag) {
    return { ok: false, code: "tag_required" };
  }
  if (!allianceName) {
    return { ok: false, code: "name_required" };
  }
  if (gameServerNumber <= 0 || gameServerNumber > 9999) {
    return { ok: false, code: "invalid_server" };
  }
  if (!isTagEligible(tag)) {
    return { ok: false, code: "tag_not_eligible" };
  }

  const existingAllianceId = await resolveAllianceIdForTag({
    tag,
    discordUserId: input.discordUserId ?? undefined,
  });
  if (existingAllianceId) {
    return {
      ok: true,
      created: false,
      allianceReady: true,
      allianceId: existingAllianceId,
    };
  }

  const db = getDb();
  const tagKey = normalizeTagKey(tag);
  const [existingOpen] = await db
    .select()
    .from(schema.hqAllianceSetupRequests)
    .where(
      and(
        eq(schema.hqAllianceSetupRequests.status, "open"),
        sql`lower(${schema.hqAllianceSetupRequests.tag}) = ${tagKey}`,
      ),
    )
    .orderBy(desc(schema.hqAllianceSetupRequests.createdAt))
    .limit(1);

  if (existingOpen) {
    if (existingOpen.requesterHqUserId === input.requesterHqUserId) {
      return {
        ok: true,
        created: false,
        allianceReady: false,
        setupRequest: mapSetupRequestRow(existingOpen),
      };
    }
    return { ok: false, code: "provision_request_open" };
  }

  const now = new Date();
  const id = nanoid(16);
  await db.insert(schema.hqAllianceSetupRequests).values({
    id,
    tag,
    allianceName,
    gameServerNumber,
    requesterHqUserId: input.requesterHqUserId,
    requesterEmail: input.requesterEmail?.trim() || null,
    discordUserId: input.discordUserId?.trim() || null,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });

  const setupRequest: AllianceSetupRequestView = {
    id,
    tag,
    allianceName,
    gameServerNumber,
    requesterHqUserId: input.requesterHqUserId,
    requesterEmail: input.requesterEmail?.trim() || null,
    discordUserId: input.discordUserId?.trim() || null,
    status: "open",
    fulfilledAllianceId: null,
    createdAt: now,
    updatedAt: now,
  };

  const adminUrl = `${discordAppBaseUrl()}/admin/alliance-setup-requests`;
  void emailPlatformMaintainers({
    subject: `Alliance setup request — ${tag}`,
    text: [
      "An officer submitted an alliance setup request from the Discord install wizard.",
      "",
      `Tag: ${tag}`,
      `Name: ${allianceName}`,
      `Server: ${gameServerNumber}`,
      `Requester: ${input.requesterEmail?.trim() || input.requesterHqUserId}`,
      "",
      `Review: ${adminUrl}`,
    ].join("\n"),
    html: [
      "<p>An officer submitted an alliance setup request from the Discord install wizard.</p>",
      "<ul>",
      `<li><strong>Tag:</strong> ${tag}</li>`,
      `<li><strong>Name:</strong> ${allianceName}</li>`,
      `<li><strong>Server:</strong> ${gameServerNumber}</li>`,
      `<li><strong>Requester:</strong> ${input.requesterEmail?.trim() || input.requesterHqUserId}</li>`,
      "</ul>",
      `<p><a href="${adminUrl}">Review setup requests</a></p>`,
    ].join(""),
    dedupeFingerprint: `alliance-setup-request:${tagKey}`,
  }).catch((error) => {
    console.error("[alliance-hq] alliance setup request maintainer alert failed", error);
  });

  return {
    ok: true,
    created: true,
    allianceReady: false,
    setupRequest,
  };
}

export async function listAllianceSetupRequestsForAdmin(
  status: AllianceSetupRequestStatus = "open",
): Promise<AllianceSetupRequestView[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.hqAllianceSetupRequests)
    .where(eq(schema.hqAllianceSetupRequests.status, status))
    .orderBy(desc(schema.hqAllianceSetupRequests.createdAt));

  return rows.map(mapSetupRequestRow);
}

export async function fulfillOpenSetupRequestForTag(input: {
  tag: string;
  allianceId: string;
  fulfilledByHqUserId: string;
}): Promise<number> {
  const tagKey = normalizeTagKey(input.tag);
  if (!tagKey) return 0;

  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(schema.hqAllianceSetupRequests)
    .set({
      status: "fulfilled",
      fulfilledAllianceId: input.allianceId,
      fulfilledByHqUserId: input.fulfilledByHqUserId,
      fulfilledAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.hqAllianceSetupRequests.status, "open"),
        sql`lower(${schema.hqAllianceSetupRequests.tag}) = ${tagKey}`,
      ),
    )
    .returning({ id: schema.hqAllianceSetupRequests.id });

  return updated.length;
}

export async function dismissAllianceSetupRequest(input: {
  requestId: string;
  dismissedByHqUserId: string;
  resolutionNote?: string | null;
}): Promise<boolean> {
  const db = getDb();
  const now = new Date();
  const updated = await db
    .update(schema.hqAllianceSetupRequests)
    .set({
      status: "dismissed",
      fulfilledByHqUserId: input.dismissedByHqUserId,
      fulfilledAt: now,
      resolutionNote: input.resolutionNote?.trim() || null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.hqAllianceSetupRequests.id, input.requestId),
        eq(schema.hqAllianceSetupRequests.status, "open"),
      ),
    )
    .returning({ id: schema.hqAllianceSetupRequests.id });

  return updated.length > 0;
}

export async function countOpenAllianceSetupRequests(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.hqAllianceSetupRequests)
    .where(eq(schema.hqAllianceSetupRequests.status, "open"));
  return row?.count ?? 0;
}
