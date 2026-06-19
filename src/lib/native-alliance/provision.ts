import "server-only";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { normalizeAshedEmail } from "@/lib/alliance/accessible";
import { getDb, schema } from "@/lib/db";
import { assignManualMembership } from "@/lib/rbac/admin-users";
import {
  ROLE_IDS,
  type SystemRoleName,
} from "@/lib/rbac/constants";

import { NATIVE_ROSTER_ASHED_ALLIANCE_ID } from "./constants";

export function slugifyNativeAlliance(name: string, tag: string): string {
  const base = `${tag}-${name}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || tag.trim().toLowerCase()).slice(0, 64);
}

async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  const db = getDb();
  let slug = baseSlug;
  let attempt = 0;

  while (attempt < 8) {
    const [existing] = await db
      .select({ id: schema.alliances.id })
      .from(schema.alliances)
      .where(eq(schema.alliances.slug, slug))
      .limit(1);

    if (!existing) {
      return slug;
    }

    attempt += 1;
    slug = `${baseSlug}-${nanoid(4).toLowerCase()}`;
  }

  throw new Error("Could not allocate a unique alliance slug.");
}

export type CreateNativeAllianceInput = {
  name: string;
  tag: string;
  ownerEmail?: string | null;
  ownerRole?: SystemRoleName;
  invitedByHqUserId?: string | null;
};

export type CreateNativeAllianceResult = {
  allianceId: string;
  slug: string;
  tag: string;
  name: string;
  ownerHqUserId: string | null;
};

export async function createNativeAlliance(
  input: CreateNativeAllianceInput,
): Promise<CreateNativeAllianceResult> {
  const name = input.name.trim();
  const tag = input.tag.trim();
  if (!name || !tag) {
    throw new Error("Alliance name and tag are required.");
  }

  const db = getDb();
  const now = new Date();
  const slug = await ensureUniqueSlug(slugifyNativeAlliance(name, tag));
  const allianceId = nanoid(16);

  let ownerHqUserId: string | null = null;
  const ownerEmail = input.ownerEmail?.trim();

  if (ownerEmail) {
    const email = normalizeAshedEmail(ownerEmail);
    const [existingUser] = await db
      .select({ id: schema.hqUsers.id })
      .from(schema.hqUsers)
      .where(eq(schema.hqUsers.email, email))
      .limit(1);

    if (existingUser) {
      ownerHqUserId = existingUser.id;
    } else {
      ownerHqUserId = nanoid(16);
      await db.insert(schema.hqUsers).values({
        id: ownerHqUserId,
        email,
        displayName: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const ownerRole = input.ownerRole ?? "owner";
    await assignManualMembership({
      hqUserId: ownerHqUserId,
      allianceId,
      roleId: ROLE_IDS[ownerRole],
    });
  }

  await db.insert(schema.alliances).values({
    id: allianceId,
    slug,
    tag,
    name,
    ashedAllianceId: null,
    operatingMode: "native",
    ownerHqUserId,
    ownerEmail: ownerEmail ? normalizeAshedEmail(ownerEmail) : null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    allianceId,
    slug,
    tag,
    name,
    ownerHqUserId,
  };
}

export function nativeRosterAshedAllianceId(allianceId: string): string {
  return `${NATIVE_ROSTER_ASHED_ALLIANCE_ID}:${allianceId}`;
}
