import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNotNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  getRuleTemplateForAlliance,
  type RuleTemplate,
} from "@/lib/trains/rules/templates.server";
import { parseTemplateWeekRules } from "@/lib/trains/rules/template-days.shared";

/**
 * Share codes for alliance-authored week templates.
 *
 * Stored hashed, like alliance join codes, so reading the table does not hand
 * out working codes. Importing **copies** the seven day rules into a new row
 * the importer owns: the two alliances then diverge, and revoking the code
 * later cannot reach back and change a schedule someone is already running.
 */

/** No I/O/0/1 — these are read off a screen and retyped into chat. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;

export function normalizeShareCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashShareCode(code: string): string {
  return createHash("sha256").update(normalizeShareCode(code)).digest("hex");
}

function shareCodeHint(code: string): string {
  const normalized = normalizeShareCode(code);
  return normalized.length <= 4 ? normalized : `…${normalized.slice(-4)}`;
}

function generateShareCode(): string {
  // Rejection-free: 31 symbols do not divide 256 evenly, so draw a byte per
  // character and re-draw the whole code rather than skew the distribution.
  let out = "";
  while (out.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      if (byte >= 248) continue; // 248 = 8 * 31, the largest unbiased cut
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

export class ShareNotAllowedError extends Error {
  readonly status = 403 as const;

  constructor(message: string) {
    super(message);
    this.name = "ShareNotAllowedError";
  }
}

/**
 * Create or rotate a template's share code.
 *
 * Rotating invalidates the previous code immediately. Templates already
 * imported from it are unaffected — they are copies.
 */
export async function createTemplateShareCode(input: {
  allianceId: string;
  templateId: string;
}): Promise<{ template: RuleTemplate; code: string; codeHint: string }> {
  const template = await getRuleTemplateForAlliance(
    input.allianceId,
    input.templateId,
  );
  if (!template) throw new ShareNotAllowedError("Template not found.");
  if (template.isPreset) {
    throw new ShareNotAllowedError(
      "Presets are already available to every alliance.",
    );
  }

  const code = generateShareCode();
  await getDb()
    .update(schema.trainRuleTemplates)
    .set({
      shareCodeHash: hashShareCode(code),
      shareCodeHint: shareCodeHint(code),
      sharedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.trainRuleTemplates.id, input.templateId),
        eq(schema.trainRuleTemplates.allianceId, input.allianceId),
      ),
    );

  const updated = await getRuleTemplateForAlliance(
    input.allianceId,
    input.templateId,
  );
  if (!updated) throw new ShareNotAllowedError("Template not found.");
  return { template: updated, code, codeHint: shareCodeHint(code) };
}

export async function revokeTemplateShareCode(input: {
  allianceId: string;
  templateId: string;
}): Promise<RuleTemplate | null> {
  await getDb()
    .update(schema.trainRuleTemplates)
    .set({
      shareCodeHash: null,
      shareCodeHint: null,
      sharedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.trainRuleTemplates.id, input.templateId),
        eq(schema.trainRuleTemplates.allianceId, input.allianceId),
      ),
    );
  return getRuleTemplateForAlliance(input.allianceId, input.templateId);
}

export type SharedTemplatePreview = {
  sourceTemplateId: string;
  name: string;
  description: string | null;
  days: ReturnType<typeof parseTemplateWeekRules>;
  /** Owning alliance tag, so an importer can see who shared it. */
  sourceAllianceTag: string | null;
  /** True when the importer already owns a copy of this template. */
  alreadyImported: boolean;
};

/**
 * Resolve a share code to a preview.
 *
 * Deliberately readable by any alliance holding the code — that is the point
 * of a share code — but it exposes only the template, never the owner's
 * schedule, roster, or other templates.
 */
export async function previewSharedTemplate(input: {
  allianceId: string;
  code: string;
}): Promise<SharedTemplatePreview | null> {
  const normalized = normalizeShareCode(input.code);
  if (!normalized) return null;

  const db = getDb();
  const [row] = await db
    .select({
      id: schema.trainRuleTemplates.id,
      allianceId: schema.trainRuleTemplates.allianceId,
      name: schema.trainRuleTemplates.name,
      description: schema.trainRuleTemplates.description,
      days: schema.trainRuleTemplates.days,
      archivedAt: schema.trainRuleTemplates.archivedAt,
      sourceAllianceTag: schema.alliances.tag,
    })
    .from(schema.trainRuleTemplates)
    .leftJoin(
      schema.alliances,
      eq(schema.alliances.id, schema.trainRuleTemplates.allianceId),
    )
    .where(
      and(
        eq(schema.trainRuleTemplates.shareCodeHash, hashShareCode(normalized)),
        isNotNull(schema.trainRuleTemplates.shareCodeHash),
      ),
    )
    .limit(1);

  // An archived template stops being importable — the owner has retired it.
  if (!row || row.archivedAt) return null;

  const selfImport = row.allianceId === input.allianceId;
  const existing = selfImport
    ? []
    : await db
        .select({ id: schema.trainRuleTemplates.id })
        .from(schema.trainRuleTemplates)
        .where(
          and(
            eq(schema.trainRuleTemplates.allianceId, input.allianceId),
            eq(schema.trainRuleTemplates.sourceTemplateId, row.id),
          ),
        )
        .limit(1);

  return {
    sourceTemplateId: row.id,
    name: row.name,
    description: row.description,
    days: parseTemplateWeekRules(row.days),
    sourceAllianceTag: row.sourceAllianceTag,
    alreadyImported: selfImport || existing.length > 0,
  };
}
