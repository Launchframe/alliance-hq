import "server-only";

import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { conductorImageDownloadPath } from "@/lib/trains/conductor-images.server";
import type {
  CreatePromptTemplateInput,
  ListPromptTemplatesQuery,
  PromptTemplateDetail,
  PromptTemplateRevisionSummary,
  PromptTemplateSummary,
  PromptTemplateType,
  PromptVisibility,
  UpdatePromptTemplateInput,
} from "@/lib/trains/prompt-templates.shared";
import type { ConductorMechanismType } from "@/lib/trains/types";

type SessionActor = {
  hqUserId: string | null;
  allianceId: string;
  isPlatformMaintainer: boolean;
};

function revisionSummary(
  row: typeof schema.trainPromptTemplateRevisions.$inferSelect,
  createdByDisplayName: string | null,
): PromptTemplateRevisionSummary {
  return {
    id: row.id,
    revisionNumber: row.revisionNumber,
    title: row.title,
    body: row.body,
    visibility: row.visibility as PromptVisibility,
    conductorMechanism:
      (row.conductorMechanism as ConductorMechanismType | null) ?? null,
    seasonKey: row.seasonKey,
    eventTag: row.eventTag,
    createdByDisplayName,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadDisplayName(hqUserId: string | null): Promise<string | null> {
  if (!hqUserId) return null;
  const db = getDb();
  const [user] = await db
    .select({ displayName: schema.hqUsers.displayName, email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  return user?.displayName?.trim() || user?.email?.trim() || null;
}

async function loadMemberName(
  allianceId: string,
  ashedMemberId: string | null,
): Promise<string | null> {
  if (!ashedMemberId) return null;
  const db = getDb();
  const [row] = await db
    .select({ currentName: schema.allianceMembers.currentName })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row?.currentName ?? null;
}

function canReadTemplate(
  actor: SessionActor,
  template: typeof schema.trainPromptTemplates.$inferSelect,
): boolean {
  if (actor.isPlatformMaintainer) return true;
  if (template.archivedAt) return false;

  if (template.visibility === "private") {
    return template.createdByHqUserId === actor.hqUserId;
  }

  if (template.visibility === "internal") {
    return template.allianceId === actor.allianceId;
  }

  // public — alliance-scoped or platform-wide (null alliance)
  return (
    template.allianceId == null || template.allianceId === actor.allianceId
  );
}

function canWriteTemplate(
  actor: SessionActor,
  template: typeof schema.trainPromptTemplates.$inferSelect,
): boolean {
  if (actor.isPlatformMaintainer) return true;
  if (template.createdByHqUserId && template.createdByHqUserId === actor.hqUserId) {
    return true;
  }
  if (template.visibility === "private") return false;
  return template.allianceId === actor.allianceId;
}

async function loadUsageStats(templateId: string) {
  const db = getDb();
  const [stats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      lastUsedAt: sql<Date | null>`max(${schema.trainConductorGeneratedImages.createdAt})`,
    })
    .from(schema.trainConductorGeneratedImages)
    .where(
      and(
        eq(schema.trainConductorGeneratedImages.promptTemplateId, templateId),
        eq(schema.trainConductorGeneratedImages.quality, "final"),
        eq(schema.trainConductorGeneratedImages.status, "completed"),
      ),
    );

  const [latestFinal] = await db
    .select({
      id: schema.trainConductorGeneratedImages.id,
      conductorRecordId: schema.trainConductorGeneratedImages.conductorRecordId,
      storageKey: schema.trainConductorGeneratedImages.storageKey,
      selectedExternalUrl: schema.trainConductorGeneratedImages.selectedExternalUrl,
    })
    .from(schema.trainConductorGeneratedImages)
    .where(
      and(
        eq(schema.trainConductorGeneratedImages.promptTemplateId, templateId),
        eq(schema.trainConductorGeneratedImages.quality, "final"),
        eq(schema.trainConductorGeneratedImages.status, "completed"),
      ),
    )
    .orderBy(desc(schema.trainConductorGeneratedImages.finalizedAt))
    .limit(1);

  let latestFinalizedImageUrl: string | null = null;
  if (latestFinal) {
    // Prefer storage-backed URL to avoid returning large base64 data URLs
    // (Craiyon stores draft data: URLs in selectedExternalUrl).
    if (latestFinal.storageKey) {
      latestFinalizedImageUrl = conductorImageDownloadPath(
        latestFinal.conductorRecordId,
        latestFinal.id,
      );
    } else {
      const external = latestFinal.selectedExternalUrl;
      // Only surface http(s) URLs; skip base64 data: blobs in the listing.
      if (external && (external.startsWith("http://") || external.startsWith("https://"))) {
        latestFinalizedImageUrl = external;
      }
    }
  }

  return {
    finalizedImageCount: stats?.count ?? 0,
    lastUsedAt: stats?.lastUsedAt ? stats.lastUsedAt.toISOString() : null,
    latestFinalizedImageUrl,
  };
}

async function toTemplateSummary(
  template: typeof schema.trainPromptTemplates.$inferSelect,
  revision: typeof schema.trainPromptTemplateRevisions.$inferSelect,
  allianceId: string,
): Promise<PromptTemplateSummary> {
  const [createdByDisplayName, targetConductorMemberName, usage] =
    await Promise.all([
      loadDisplayName(template.createdByHqUserId),
      loadMemberName(allianceId, template.targetConductorAshedMemberId),
      loadUsageStats(template.id),
    ]);

  return {
    id: template.id,
    templateType: template.templateType as PromptTemplateType,
    title: template.title,
    visibility: template.visibility as PromptVisibility,
    conductorMechanism:
      (template.conductorMechanism as ConductorMechanismType | null) ?? null,
    seasonKey: template.seasonKey,
    eventTag: template.eventTag,
    targetConductorAshedMemberId: template.targetConductorAshedMemberId,
    targetConductorMemberName,
    isDefault: template.isDefault === 1,
    createdByDisplayName,
    lastUsedAt: usage.lastUsedAt,
    finalizedImageCount: usage.finalizedImageCount,
    latestFinalizedImageUrl: usage.latestFinalizedImageUrl,
    currentRevision: revisionSummary(revision, createdByDisplayName),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

export async function listPromptTemplatesForActor(
  actor: SessionActor,
  query: ListPromptTemplatesQuery = {},
): Promise<PromptTemplateSummary[]> {
  const db = getDb();
  const conditions = [isNull(schema.trainPromptTemplates.archivedAt)];

  if (query.type) {
    conditions.push(eq(schema.trainPromptTemplates.templateType, query.type));
  }
  if (query.visibility) {
    conditions.push(eq(schema.trainPromptTemplates.visibility, query.visibility));
  }
  if (query.conductorMechanism) {
    conditions.push(
      eq(
        schema.trainPromptTemplates.conductorMechanism,
        query.conductorMechanism,
      ),
    );
  }
  if (query.seasonKey) {
    conditions.push(eq(schema.trainPromptTemplates.seasonKey, query.seasonKey));
  }
  if (query.search?.trim()) {
    conditions.push(
      ilike(schema.trainPromptTemplates.title, `%${query.search.trim()}%`),
    );
  }
  if (query.conductorMemberId) {
    conditions.push(
      eq(
        schema.trainPromptTemplates.targetConductorAshedMemberId,
        query.conductorMemberId,
      ),
    );
  }

  conditions.push(
    or(
      eq(schema.trainPromptTemplates.allianceId, actor.allianceId),
      isNull(schema.trainPromptTemplates.allianceId),
    )!,
  );

  const rows = await db
    .select({
      template: schema.trainPromptTemplates,
      revision: schema.trainPromptTemplateRevisions,
    })
    .from(schema.trainPromptTemplates)
    .innerJoin(
      schema.trainPromptTemplateRevisions,
      eq(
        schema.trainPromptTemplates.currentRevisionId,
        schema.trainPromptTemplateRevisions.id,
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.trainPromptTemplates.updatedAt));

  const summaries: PromptTemplateSummary[] = [];
  for (const row of rows) {
    if (!canReadTemplate(actor, row.template)) continue;
    summaries.push(
      await toTemplateSummary(row.template, row.revision, actor.allianceId),
    );
  }
  return summaries;
}

export async function getPromptTemplateForActor(
  actor: SessionActor,
  templateId: string,
): Promise<PromptTemplateDetail | null> {
  const db = getDb();
  const [row] = await db
    .select({
      template: schema.trainPromptTemplates,
      revision: schema.trainPromptTemplateRevisions,
    })
    .from(schema.trainPromptTemplates)
    .innerJoin(
      schema.trainPromptTemplateRevisions,
      eq(
        schema.trainPromptTemplates.currentRevisionId,
        schema.trainPromptTemplateRevisions.id,
      ),
    )
    .where(eq(schema.trainPromptTemplates.id, templateId))
    .limit(1);

  if (!row || !canReadTemplate(actor, row.template)) return null;

  const revisions = await db
    .select()
    .from(schema.trainPromptTemplateRevisions)
    .where(eq(schema.trainPromptTemplateRevisions.templateId, templateId))
    .orderBy(desc(schema.trainPromptTemplateRevisions.revisionNumber));

  const summary = await toTemplateSummary(
    row.template,
    row.revision,
    actor.allianceId,
  );

  const revisionSummaries = await Promise.all(
    revisions.map(async (rev) =>
      revisionSummary(rev, await loadDisplayName(rev.createdByHqUserId)),
    ),
  );

  return { ...summary, revisions: revisionSummaries };
}

export async function createPromptTemplateForActor(
  actor: SessionActor,
  input: CreatePromptTemplateInput,
): Promise<PromptTemplateDetail> {
  if (!actor.hqUserId) {
    throw new Error("Sign in required to save prompt templates.");
  }

  const db = getDb();
  const templateId = nanoid();
  const revisionId = nanoid();
  const now = new Date();

  await db.insert(schema.trainPromptTemplates).values({
    id: templateId,
    allianceId: actor.allianceId,
    createdByHqUserId: actor.hqUserId,
    templateType: input.templateType,
    title: input.title.trim(),
    visibility: input.visibility,
    conductorMechanism: input.conductorMechanism ?? null,
    seasonKey: input.seasonKey ?? null,
    eventTag: input.eventTag ?? null,
    targetConductorAshedMemberId: input.targetConductorAshedMemberId ?? null,
    isDefault: input.isDefault ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.trainPromptTemplateRevisions).values({
    id: revisionId,
    templateId,
    body: input.body.trim(),
    title: input.title.trim(),
    visibility: input.visibility,
    conductorMechanism: input.conductorMechanism ?? null,
    seasonKey: input.seasonKey ?? null,
    eventTag: input.eventTag ?? null,
    revisionNumber: 1,
    createdByHqUserId: actor.hqUserId,
    createdAt: now,
  });

  await db
    .update(schema.trainPromptTemplates)
    .set({ currentRevisionId: revisionId, updatedAt: now })
    .where(eq(schema.trainPromptTemplates.id, templateId));

  const created = await getPromptTemplateForActor(actor, templateId);
  if (!created) {
    throw new Error("Failed to load created prompt template.");
  }
  return created;
}

export async function updatePromptTemplateForActor(
  actor: SessionActor,
  templateId: string,
  input: UpdatePromptTemplateInput,
): Promise<PromptTemplateDetail> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.trainPromptTemplates)
    .where(eq(schema.trainPromptTemplates.id, templateId))
    .limit(1);

  if (!existing || !canWriteTemplate(actor, existing)) {
    throw new Error("Prompt template not found or not editable.");
  }

  const [latestRevision] = await db
    .select()
    .from(schema.trainPromptTemplateRevisions)
    .where(eq(schema.trainPromptTemplateRevisions.templateId, templateId))
    .orderBy(desc(schema.trainPromptTemplateRevisions.revisionNumber))
    .limit(1);

  if (!latestRevision) {
    throw new Error("Prompt template has no revisions.");
  }

  const nextTitle = input.title?.trim() ?? existing.title;
  const nextBody = input.body?.trim() ?? latestRevision.body;
  const nextVisibility = input.visibility ?? existing.visibility;
  const nextMechanism =
    input.conductorMechanism !== undefined
      ? input.conductorMechanism
      : existing.conductorMechanism;
  const nextSeasonKey =
    input.seasonKey !== undefined ? input.seasonKey : existing.seasonKey;
  const nextEventTag =
    input.eventTag !== undefined ? input.eventTag : existing.eventTag;
  const nextTargetMember =
    input.targetConductorAshedMemberId !== undefined
      ? input.targetConductorAshedMemberId
      : existing.targetConductorAshedMemberId;

  const contentChanged =
    nextTitle !== latestRevision.title ||
    nextBody !== latestRevision.body ||
    nextVisibility !== latestRevision.visibility ||
    nextMechanism !== latestRevision.conductorMechanism ||
    nextSeasonKey !== latestRevision.seasonKey ||
    nextEventTag !== latestRevision.eventTag;

  const now = new Date();
  let currentRevisionId = existing.currentRevisionId;

  if (contentChanged) {
    const revisionId = nanoid();
    await db.insert(schema.trainPromptTemplateRevisions).values({
      id: revisionId,
      templateId,
      body: nextBody,
      title: nextTitle,
      visibility: nextVisibility,
      conductorMechanism: nextMechanism,
      seasonKey: nextSeasonKey,
      eventTag: nextEventTag,
      revisionNumber: latestRevision.revisionNumber + 1,
      createdByHqUserId: actor.hqUserId,
      createdAt: now,
    });
    currentRevisionId = revisionId;
  }

  await db
    .update(schema.trainPromptTemplates)
    .set({
      title: nextTitle,
      visibility: nextVisibility,
      conductorMechanism: nextMechanism,
      seasonKey: nextSeasonKey,
      eventTag: nextEventTag,
      targetConductorAshedMemberId: nextTargetMember,
      isDefault:
        input.isDefault !== undefined
          ? input.isDefault
            ? 1
            : 0
          : existing.isDefault,
      currentRevisionId,
      updatedAt: now,
    })
    .where(eq(schema.trainPromptTemplates.id, templateId));

  const updated = await getPromptTemplateForActor(actor, templateId);
  if (!updated) {
    throw new Error("Failed to load updated prompt template.");
  }
  return updated;
}

export async function loadPromptTemplateActor(
  sessionId: string,
): Promise<SessionActor | null> {
  const { loadSession } = await import("@/lib/session");
  const { sessionHasPermission } = await import("@/lib/rbac/context");

  const session = await loadSession(sessionId);
  if (!session) return null;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) return null;

  const isPlatformMaintainer = await sessionHasPermission(sessionId, "hq:admin");

  return {
    hqUserId: session.hqUserId,
    allianceId,
    isPlatformMaintainer,
  };
}
