import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import * as schema from "@/lib/db/schema";

import { activityIdentifierSchema } from "./types.shared";
import type { ActivityTransaction } from "./writer.server";

export class ActivityIdentityChangedError extends Error {
  constructor() {
    super("activity_identity_changed");
    this.name = "ActivityIdentityChangedError";
  }
}

function requireActivityIdentifier(value: string): string {
  const parsed = activityIdentifierSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("activity_identifier_invalid");
  }
  return parsed.data;
}

export async function lockActivityIdentity(
  tx: ActivityTransaction,
  input: { discordUserId?: string | null; hqUserIds?: readonly string[] },
): Promise<void> {
  const keys = [
    ...new Set([
      ...(input.discordUserId != null
        ? [`activity:discord:${requireActivityIdentifier(input.discordUserId)}`]
        : []),
      ...(input.hqUserIds ?? []).map(
        (id) => `activity:hq:${requireActivityIdentifier(id)}`,
      ),
    ]),
  ].sort();
  for (const key of keys) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}

export async function resolveActivityPersonalOwner(
  tx: ActivityTransaction,
  input: { hqUserId: string | null; discordUserId: string | null },
): Promise<string | null> {
  if (input.hqUserId !== null) {
    const hqUserId = requireActivityIdentifier(input.hqUserId);
    await lockActivityIdentity(tx, { hqUserIds: [hqUserId] });
    const [alias] = await tx
      .select({
        owner: schema.activityOwnershipAliases.personalOwnerHqUserId,
      })
      .from(schema.activityOwnershipAliases)
      .where(
        eq(schema.activityOwnershipAliases.originalHqUserId, hqUserId),
      )
      .limit(1);
    return alias?.owner ?? hqUserId;
  }
  if (input.discordUserId !== null) {
    const discordUserId = requireActivityIdentifier(input.discordUserId);
    await lockActivityIdentity(tx, { discordUserId });
    const [link] = await tx
      .select({ hqUserId: schema.discordHqLinks.hqUserId })
      .from(schema.discordHqLinks)
      .where(eq(schema.discordHqLinks.discordUserId, discordUserId))
      .for("share");
    if (!link) {
      return null;
    }
    return resolveActivityPersonalOwner(tx, {
      hqUserId: link.hqUserId,
      discordUserId: null,
    });
  }
  return null;
}

export async function lockActivityMergeOwners(
  tx: ActivityTransaction,
  sourceId: string,
  canonicalId: string,
): Promise<void> {
  const source = requireActivityIdentifier(sourceId);
  const canonical = requireActivityIdentifier(canonicalId);
  const loadAliasIds = async () => {
    const rows = await tx
      .select({
        originalHqUserId:
          schema.activityOwnershipAliases.originalHqUserId,
      })
      .from(schema.activityOwnershipAliases)
      .where(
        eq(
          schema.activityOwnershipAliases.personalOwnerHqUserId,
          source,
        ),
      );
    return [...new Set(rows.map((row) => row.originalHqUserId))].sort();
  };
  const before = await loadAliasIds();
  await lockActivityIdentity(tx, {
    hqUserIds: [source, canonical, ...before],
  });
  const after = await loadAliasIds();
  if (before.join("\n") !== after.join("\n")) {
    throw new ActivityIdentityChangedError();
  }
}

export async function claimDiscordActivityOwnership(
  tx: ActivityTransaction,
  input: { discordUserId: string; hqUserId: string },
): Promise<void> {
  const discordUserId = requireActivityIdentifier(input.discordUserId);
  const hqUserId = requireActivityIdentifier(input.hqUserId);
  await lockActivityIdentity(tx, {
    discordUserId,
    hqUserIds: [hqUserId],
  });
  const [link] = await tx
    .select({ hqUserId: schema.discordHqLinks.hqUserId })
    .from(schema.discordHqLinks)
    .where(eq(schema.discordHqLinks.discordUserId, discordUserId))
    .for("share");
  if (link?.hqUserId !== hqUserId) {
    throw new ActivityIdentityChangedError();
  }
  await tx
    .update(schema.activityEvents)
    .set({ personalOwnerHqUserId: hqUserId })
    .where(
      and(
        eq(schema.activityEvents.actorKind, "discord"),
        eq(schema.activityEvents.originalDiscordUserId, discordUserId),
        isNull(schema.activityEvents.personalOwnerHqUserId),
      ),
    );
}

export async function remapActivityOwnership(
  tx: ActivityTransaction,
  sourceId: string,
  canonicalId: string,
): Promise<void> {
  const source = requireActivityIdentifier(sourceId);
  const canonical = requireActivityIdentifier(canonicalId);
  if (source === canonical) {
    return;
  }
  await lockActivityMergeOwners(tx, source, canonical);
  const [canonicalAlias] = await tx
    .select({
      owner: schema.activityOwnershipAliases.personalOwnerHqUserId,
    })
    .from(schema.activityOwnershipAliases)
    .where(eq(schema.activityOwnershipAliases.originalHqUserId, canonical))
    .limit(1);
  if (canonicalAlias) {
    throw new ActivityIdentityChangedError();
  }
  const [sourceAlias] = await tx
    .select({
      owner: schema.activityOwnershipAliases.personalOwnerHqUserId,
    })
    .from(schema.activityOwnershipAliases)
    .where(eq(schema.activityOwnershipAliases.originalHqUserId, source))
    .limit(1);
  if (sourceAlias) {
    if (sourceAlias.owner !== canonical) {
      throw new ActivityIdentityChangedError();
    }
    return;
  }
  await tx
    .update(schema.activityEvents)
    .set({ personalOwnerHqUserId: canonical })
    .where(eq(schema.activityEvents.personalOwnerHqUserId, source));
  await tx
    .update(schema.activityOwnershipAliases)
    .set({ personalOwnerHqUserId: canonical })
    .where(
      eq(schema.activityOwnershipAliases.personalOwnerHqUserId, source),
    );
  await tx
    .insert(schema.activityOwnershipAliases)
    .values({
      originalHqUserId: source,
      personalOwnerHqUserId: canonical,
    })
    .onConflictDoUpdate({
      target: schema.activityOwnershipAliases.originalHqUserId,
      set: { personalOwnerHqUserId: canonical },
    });
}
