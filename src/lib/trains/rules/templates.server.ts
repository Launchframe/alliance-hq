import "server-only";

import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  parseTemplateWeekRules,
  type TemplateWeekRules,
} from "@/lib/trains/rules/template-days.shared";

/**
 * Week templates as data.
 *
 * Presets (`alliance_id IS NULL`) are shared by every alliance and can only
 * be hidden per alliance, never edited or deleted. Alliance-authored rows are
 * editable and soft-delete, so days already painted from them keep resolving.
 */

export type RuleTemplate = {
  id: string;
  allianceId: string | null;
  presetKey: string | null;
  name: string;
  description: string | null;
  days: TemplateWeekRules;
  isPreset: boolean;
  /** Hidden for this alliance (preset archive row, or own `archived_at`). */
  archived: boolean;
  sourceTemplateId: string | null;
  /** Last four characters of the active share code; null when not shared. */
  shareCodeHint: string | null;
  updatedAt: string;
};

function mapRow(
  row: typeof schema.trainRuleTemplates.$inferSelect,
  archivedPresetIds: ReadonlySet<string>,
): RuleTemplate {
  const isPreset = row.allianceId === null;
  return {
    id: row.id,
    allianceId: row.allianceId,
    presetKey: row.presetKey,
    name: row.name,
    description: row.description,
    days: parseTemplateWeekRules(row.days),
    isPreset,
    archived: isPreset
      ? archivedPresetIds.has(row.id)
      : row.archivedAt != null,
    sourceTemplateId: row.sourceTemplateId,
    // Only the hint is ever exposed — the code itself is returned once, at
    // creation, and stored hashed.
    shareCodeHint: row.shareCodeHash ? row.shareCodeHint : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadArchivedPresetIds(
  allianceId: string,
): Promise<Set<string>> {
  const rows = await getDb()
    .select({ templateId: schema.trainRuleTemplateArchives.templateId })
    .from(schema.trainRuleTemplateArchives)
    .where(eq(schema.trainRuleTemplateArchives.allianceId, allianceId));
  return new Set(rows.map((row) => row.templateId));
}

/** Presets plus this alliance's own templates. Never another alliance's. */
export async function listRuleTemplatesForAlliance(
  allianceId: string,
): Promise<RuleTemplate[]> {
  const db = getDb();
  const [rows, archivedPresetIds] = await Promise.all([
    db
      .select()
      .from(schema.trainRuleTemplates)
      .where(
        or(
          isNull(schema.trainRuleTemplates.allianceId),
          eq(schema.trainRuleTemplates.allianceId, allianceId),
        ),
      )
      .orderBy(
        asc(schema.trainRuleTemplates.allianceId),
        asc(schema.trainRuleTemplates.name),
      ),
    loadArchivedPresetIds(allianceId),
  ]);
  return rows.map((row) => mapRow(row, archivedPresetIds));
}

/** Tenant-scoped read: presets, or a template this alliance owns. */
export async function getRuleTemplateForAlliance(
  allianceId: string,
  templateId: string,
): Promise<RuleTemplate | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.trainRuleTemplates)
    .where(
      and(
        eq(schema.trainRuleTemplates.id, templateId),
        or(
          isNull(schema.trainRuleTemplates.allianceId),
          eq(schema.trainRuleTemplates.allianceId, allianceId),
        ),
      ),
    )
    .limit(1);
  if (!row) return null;
  return mapRow(row, await loadArchivedPresetIds(allianceId));
}

export async function getRuleTemplateByPresetKey(
  presetKey: string,
): Promise<typeof schema.trainRuleTemplates.$inferSelect | null> {
  const [row] = await getDb()
    .select()
    .from(schema.trainRuleTemplates)
    .where(eq(schema.trainRuleTemplates.presetKey, presetKey))
    .limit(1);
  return row ?? null;
}

export class RuleTemplateNameTakenError extends Error {
  readonly status = 409 as const;

  constructor() {
    super("An alliance template with that name already exists.");
    this.name = "RuleTemplateNameTakenError";
  }
}

/**
 * Postgres unique violation, however the driver wrapped it.
 *
 * Drizzle re-throws the postgres.js error as its own, so the SQLSTATE can be
 * one level down in `cause`.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    if (
      typeof current === "object" &&
      (current as { code?: string }).code === "23505"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function createRuleTemplate(input: {
  allianceId: string;
  name: string;
  description: string | null;
  days: TemplateWeekRules;
  createdByHqUserId: string | null;
  sourceTemplateId?: string | null;
}): Promise<RuleTemplate> {
  const id = nanoid();
  try {
    await getDb().insert(schema.trainRuleTemplates).values({
      id,
      allianceId: input.allianceId,
      presetKey: null,
      name: input.name,
      description: input.description,
      days: input.days,
      createdByHqUserId: input.createdByHqUserId,
      sourceTemplateId: input.sourceTemplateId ?? null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new RuleTemplateNameTakenError();
    throw error;
  }
  const created = await getRuleTemplateForAlliance(input.allianceId, id);
  if (!created) throw new Error("Template was not created.");
  return created;
}

/** Alliance-owned rows only — presets are immutable. */
export async function updateRuleTemplate(input: {
  allianceId: string;
  templateId: string;
  name?: string;
  description?: string | null;
  days?: TemplateWeekRules;
}): Promise<RuleTemplate | null> {
  const db = getDb();
  try {
    const updated = await db
      .update(schema.trainRuleTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.days !== undefined ? { days: input.days } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.trainRuleTemplates.id, input.templateId),
          eq(schema.trainRuleTemplates.allianceId, input.allianceId),
        ),
      )
      .returning({ id: schema.trainRuleTemplates.id });
    if (updated.length === 0) return null;
  } catch (error) {
    if (isUniqueViolation(error)) throw new RuleTemplateNameTakenError();
    throw error;
  }
  return getRuleTemplateForAlliance(input.allianceId, input.templateId);
}

/**
 * Archive hides a template from this alliance's pickers.
 *
 * Presets get an alliance-scoped archive row — the preset itself is never
 * deleted, so another alliance is unaffected and this one can restore it.
 * Alliance-authored rows set `archived_at`; days painted from them keep
 * resolving because the rule lives on the day, not on the template.
 */
export async function archiveRuleTemplate(input: {
  allianceId: string;
  templateId: string;
  hqUserId: string | null;
  archived: boolean;
}): Promise<RuleTemplate | null> {
  const db = getDb();
  const template = await getRuleTemplateForAlliance(
    input.allianceId,
    input.templateId,
  );
  if (!template) return null;

  if (template.isPreset) {
    if (input.archived) {
      await db
        .insert(schema.trainRuleTemplateArchives)
        .values({
          id: nanoid(),
          allianceId: input.allianceId,
          templateId: input.templateId,
          archivedByHqUserId: input.hqUserId,
        })
        .onConflictDoNothing();
    } else {
      await db
        .delete(schema.trainRuleTemplateArchives)
        .where(
          and(
            eq(schema.trainRuleTemplateArchives.allianceId, input.allianceId),
            eq(schema.trainRuleTemplateArchives.templateId, input.templateId),
          ),
        );
    }
  } else {
    await db
      .update(schema.trainRuleTemplates)
      .set({
        archivedAt: input.archived ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.trainRuleTemplates.id, input.templateId),
          eq(schema.trainRuleTemplates.allianceId, input.allianceId),
        ),
      );
  }

  return getRuleTemplateForAlliance(input.allianceId, input.templateId);
}

/** Resolve a week schedule's template id back to its rules. */
export async function loadTemplateDays(
  templateId: string,
): Promise<TemplateWeekRules | null> {
  const [row] = await getDb()
    .select({ days: schema.trainRuleTemplates.days })
    .from(schema.trainRuleTemplates)
    .where(eq(schema.trainRuleTemplates.id, templateId))
    .limit(1);
  return row ? parseTemplateWeekRules(row.days) : null;
}

/** Count of alliance-authored templates, for the settings empty state. */
export async function countAllianceRuleTemplates(
  allianceId: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.trainRuleTemplates)
    .where(eq(schema.trainRuleTemplates.allianceId, allianceId));
  return row?.count ?? 0;
}
