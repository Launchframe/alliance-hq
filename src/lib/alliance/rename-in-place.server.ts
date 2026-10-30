import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";

import {
  normalizeAllianceNameInput,
  normalizeAllianceTagInput,
} from "@/lib/alliance/rename-in-place.shared";
import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import {
  lookupLastRankSyncByAllianceId,
  lookupLastRankSyncByServerAndTag,
} from "@/lib/lastrank/sync-registry.shared";
import { slugifyNativeAlliance } from "@/lib/native-alliance/provision";

export class AllianceRenameError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "INVALID" | "CONFLICT",
  ) {
    super(message);
    this.name = "AllianceRenameError";
  }
}

export type RenameAllianceInPlaceInput = {
  allianceId: string;
  tag: string;
  name: string;
  /** Optional explicit LastRank pin (32-char hex). */
  lastrankAllianceId?: string | null;
  sessionId?: string | null;
  hqUserId?: string | null;
};

export type RenameAllianceInPlaceResult = {
  allianceId: string;
  tag: string;
  name: string;
  slug: string;
  previousTag: string | null;
  previousName: string;
  lastrankAllianceId: string | null;
  lastRankRegistryTag: string | null;
};

async function ensureUniqueSlug(
  baseSlug: string,
  excludingAllianceId: string,
): Promise<string> {
  const db = getDb();
  let slug = baseSlug;
  let attempt = 0;
  while (attempt < 8) {
    const [existing] = await db
      .select({ id: schema.alliances.id })
      .from(schema.alliances)
      .where(
        and(
          eq(schema.alliances.slug, slug),
          ne(schema.alliances.id, excludingAllianceId),
        ),
      )
      .limit(1);
    if (!existing) return slug;
    attempt += 1;
    slug = `${baseSlug}-${attempt + 1}`;
  }
  throw new AllianceRenameError(
    "Could not allocate a unique alliance slug.",
    "CONFLICT",
  );
}

function resolveLastRankPin(input: {
  gameServerNumber: number;
  previousTag: string | null;
  nextTag: string;
  existingPin: string | null;
  explicitPin: string | null | undefined;
}): string | null {
  const explicit = input.explicitPin?.trim().toLowerCase() || null;
  if (explicit) {
    if (!/^[a-f0-9]{32}$/.test(explicit)) {
      throw new AllianceRenameError(
        "LastRank alliance id must be a 32-character hex string.",
        "INVALID",
      );
    }
    return explicit;
  }
  if (input.existingPin?.trim()) {
    return input.existingPin.trim().toLowerCase();
  }
  const byNewTag = lookupLastRankSyncByServerAndTag(
    input.gameServerNumber,
    input.nextTag,
  );
  if (byNewTag) return byNewTag.lastrankAllianceId.toLowerCase();
  if (input.previousTag?.trim()) {
    const byOldTag = lookupLastRankSyncByServerAndTag(
      input.gameServerNumber,
      input.previousTag,
    );
    if (byOldTag) return byOldTag.lastrankAllianceId.toLowerCase();
  }
  return null;
}

/**
 * Retag an existing HQ alliance in place (same alliances.id).
 * Pins LastRank id when known from explicit input, existing column, or registry.
 */
export async function renameAllianceInPlace(
  input: RenameAllianceInPlaceInput,
): Promise<RenameAllianceInPlaceResult> {
  const tag = normalizeAllianceTagInput(input.tag);
  const name = normalizeAllianceNameInput(input.name);
  if (!tag || !name) {
    throw new AllianceRenameError(
      "Alliance tag and name are required.",
      "INVALID",
    );
  }
  if (tag.length > 32) {
    throw new AllianceRenameError(
      "Alliance tag must be 32 characters or fewer.",
      "INVALID",
    );
  }

  const db = getDb();
  const [existing] = await db
    .select({
      id: schema.alliances.id,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
      slug: schema.alliances.slug,
      gameServerNumber: schema.alliances.gameServerNumber,
      lastrankAllianceId: schema.alliances.lastrankAllianceId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);

  if (!existing) {
    throw new AllianceRenameError("Alliance not found.", "NOT_FOUND");
  }

  const previousTag = existing.tag?.trim() || null;
  const previousName = existing.name;
  const sameTag =
    previousTag != null && previousTag.toLowerCase() === tag.toLowerCase();
  const sameName = previousName.trim() === name;
  const lastrankAllianceId = resolveLastRankPin({
    gameServerNumber: existing.gameServerNumber,
    previousTag,
    nextTag: tag,
    existingPin: existing.lastrankAllianceId,
    explicitPin: input.lastrankAllianceId,
  });

  if (lastrankAllianceId) {
    const [pinOwner] = await db
      .select({ id: schema.alliances.id })
      .from(schema.alliances)
      .where(
        and(
          sql`lower(${schema.alliances.lastrankAllianceId}) = ${lastrankAllianceId}`,
          ne(schema.alliances.id, existing.id),
        ),
      )
      .limit(1);
    if (pinOwner) {
      throw new AllianceRenameError(
        "That LastRank alliance id is already pinned to another HQ alliance.",
        "CONFLICT",
      );
    }
  }

  const baseSlug = slugifyNativeAlliance(name, tag);
  const slug =
    sameTag && sameName && existing.slug
      ? existing.slug
      : await ensureUniqueSlug(baseSlug, existing.id);

  if (
    sameTag &&
    sameName &&
    (existing.lastrankAllianceId?.toLowerCase() ?? null) === lastrankAllianceId
  ) {
    const registry = lastrankAllianceId
      ? lookupLastRankSyncByAllianceId(lastrankAllianceId)
      : null;
    return {
      allianceId: existing.id,
      tag: previousTag ?? tag,
      name: previousName,
      slug: existing.slug,
      previousTag,
      previousName,
      lastrankAllianceId,
      lastRankRegistryTag: registry?.tag ?? null,
    };
  }

  const now = new Date();
  await db
    .update(schema.alliances)
    .set({
      tag,
      name,
      slug,
      lastrankAllianceId,
      updatedAt: now,
    })
    .where(eq(schema.alliances.id, existing.id));

  // Keep live sessions that were on this alliance from showing the old tag.
  await db
    .update(schema.sessions)
    .set({
      allianceTag: tag,
      updatedAt: now,
    })
    .where(eq(schema.sessions.currentAllianceId, existing.id));

  if (input.sessionId) {
    await writeAuditLog({
      sessionId: input.sessionId,
      allianceId: existing.id,
      hqUserId: input.hqUserId ?? undefined,
      action: "alliance.rename_in_place",
      resourceType: "alliance",
      resourceId: existing.id,
      resourceName: name,
      metadata: {
        before: {
          tag: previousTag,
          name: previousName,
          slug: existing.slug,
          lastrankAllianceId: existing.lastrankAllianceId,
        },
        after: {
          tag,
          name,
          slug,
          lastrankAllianceId,
        },
        via: "admin_console",
      },
    });
  }

  const registry = lastrankAllianceId
    ? lookupLastRankSyncByAllianceId(lastrankAllianceId)
    : null;

  return {
    allianceId: existing.id,
    tag,
    name,
    slug,
    previousTag,
    previousName,
    lastrankAllianceId,
    lastRankRegistryTag: registry?.tag ?? null,
  };
}
