import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto/encrypt";
import type { KnowledgeWebActor } from "./access.server";
import { getPerformanceNoteForAlliance } from "@/lib/performance-notes/repository.server";
import { knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, type KnowledgeTransaction } from "./resources.server";
import { recheckKnowledgeReader } from "./knowledge-access.server";
import { withKnowledgeReceipt } from "./mutations.server";
import { publicSnapshotText, type Publication, publicationPreviewSchema, publicationCommandSchema } from "./publications.shared";

const publications = schema.knowledgePublications, resources = schema.knowledgeResources;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
async function requirePublisher(tx: KnowledgeTransaction, actor: KnowledgeWebActor) {
  await recheckKnowledgeReader(tx, actor);
  const [allowed] = await tx.select({ id: schema.rolePermissions.permissionId }).from(schema.allianceMemberships).innerJoin(schema.roles, eq(schema.roles.id, schema.allianceMemberships.roleId)).innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
    .where(and(eq(schema.allianceMemberships.allianceId, actor.allianceId), eq(schema.allianceMemberships.hqUserId, actor.hqUserId!), eq(schema.allianceMemberships.status, "active"), inArray(schema.roles.name, ["owner", "maintainer", "officer"]), eq(schema.rolePermissions.permissionId, "notes:publish"))).for("share");
  if (!allowed) throw new KnowledgeAccessError("forbidden");
}
function dto(row: typeof publications.$inferSelect, actor: KnowledgeWebActor): Publication {
  const link = row.state === "published" && row.ownerHqUserId === actor.hqUserId && row.tokenCipher ? `/${row.locale}/shared/notes/${decryptSecret(row.tokenCipher)}` : null;
  return { id: row.id, noteId: row.noteId, state: row.state, version: row.version, snapshotVersion: row.snapshotVersion, title: row.title, body: row.body, locale: row.locale, expiresAt: row.expiresAt.toISOString(), link };
}
export async function getPublication(actor: KnowledgeWebActor, id: string) {
  const [row] = await getDb().select().from(publications).where(and(eq(publications.id, id), eq(publications.allianceId, actor.allianceId), knowledgeAccessCondition(actor, publications.resourceId, "share")));
  if (!row) throw new KnowledgeAccessError("not_found");
  return dto(row, actor);
}
export async function listPublications(actor: KnowledgeWebActor, noteId: string) {
  const note = await getPerformanceNoteForAlliance({ actor, noteId, access: "share" });
  if (!note) throw new KnowledgeAccessError("not_found");
  const rows = await getDb().select().from(publications).where(and(eq(publications.noteId, noteId), eq(publications.allianceId, actor.allianceId))).orderBy(desc(publications.snapshotVersion)).limit(50);
  return rows.map((row) => dto(row, actor));
}
export async function preparePublication(actor: KnowledgeWebActor, input: z.infer<typeof publicationPreviewSchema>) {
  const note = await getPerformanceNoteForAlliance({ actor, noteId: input.noteId, access: "share" });
  if (!note) throw new KnowledgeAccessError("not_found");
  const title = publicSnapshotText(input.title), body = publicSnapshotText(input.body);
  if (!title || !body || title.length > 160 || body.length > 100_000) throw new KnowledgeAccessError("invalid");
  const result = await withKnowledgeReceipt(actor, "notes.publication_preview", input.requestId, input, async (tx) => {
    await requirePublisher(tx, actor);
    const resource = await lockKnowledgeResource(tx, actor, note.resourceId, "share");
    if (resource.version !== input.expectedVersion || resource.archivedAt) throw new KnowledgeAccessError("changed");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`publication-quota:${actor.hqUserId}`}, 0))`);
    const [quota] = await tx.select({ count: sql<number>`count(*)` }).from(publications).where(and(eq(publications.ownerHqUserId, actor.hqUserId!), sql`created_at > now() - interval '1 day'`));
    if (Number(quota.count) >= 30) throw new KnowledgeAccessError("rate_limited");
    const [previous] = await tx.select({ value: sql<number>`coalesce(max(snapshot_version), 0)` }).from(publications).where(eq(publications.resourceId, resource.id));
    const id = nanoid();
    await tx.insert(publications).values({ id, allianceId: actor.allianceId, noteId: note.id, resourceId: resource.id, ownerHqUserId: actor.hqUserId!, sourceVersion: resource.version, snapshotVersion: Number(previous.value) + 1, title, body, locale: input.locale, expiresAt: new Date(Date.now() + input.days * 86_400_000) });
    return { publicationId: id };
  });
  return getPublication(actor, result.publicationId!);
}
export async function changePublication(actor: KnowledgeWebActor, id: string, input: z.infer<typeof publicationCommandSchema>) {
  await getPublication(actor, id);
  await withKnowledgeReceipt(actor, `notes.publication_${input.command}`, input.requestId, { id, ...input }, async (tx) => {
    if (input.command !== "revoke") await requirePublisher(tx, actor); else await recheckKnowledgeReader(tx, actor);
    const [existing] = await tx.select().from(publications).where(and(eq(publications.id, id), eq(publications.allianceId, actor.allianceId)));
    const resource = await lockKnowledgeResource(tx, actor, existing.resourceId, "share");
    const [row] = await tx.select().from(publications).where(eq(publications.id, id)).for("update");
    if (input.command === "revoke") {
      await tx.update(publications).set({ state: "revoked", tokenHash: null, tokenCipher: null, version: row.version + 1 }).where(eq(publications.id, id));
    } else {
      const [note] = await tx.select({ id: schema.performanceNotes.id }).from(schema.performanceNotes).where(and(eq(schema.performanceNotes.id, row.noteId), isNull(schema.performanceNotes.expungedAt)));
      if (!note || resource.archivedAt || row.ownerHqUserId !== actor.hqUserId || row.version !== input.expectedVersion || row.expiresAt <= new Date()) throw new KnowledgeAccessError("changed");
      if (input.command === "publish" ? row.state !== "draft" || !input.reviewed || resource.version !== row.sourceVersion : row.state !== "published") throw new KnowledgeAccessError("changed");
      const token = randomBytes(32).toString("base64url");
      await tx.update(publications).set({ state: "published", tokenHash: tokenHash(token), tokenCipher: encryptSecret(token), publishedAt: row.publishedAt ?? new Date(), version: row.version + 1 }).where(eq(publications.id, id));
    }
    return { publicationId: id };
  });
  return getPublication(actor, id);
}
export async function getPublicSnapshot(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  try {
    const [row] = await getDb().select({ title: publications.title, body: publications.body, locale: publications.locale, version: publications.snapshotVersion, expiresAt: publications.expiresAt, publishedAt: publications.publishedAt }).from(publications)
      .innerJoin(resources, and(eq(resources.id, publications.resourceId), eq(resources.allianceId, publications.allianceId)))
      .innerJoin(schema.performanceNotes, and(eq(schema.performanceNotes.id, publications.noteId), eq(schema.performanceNotes.resourceId, resources.id)))
      .where(and(eq(publications.tokenHash, tokenHash(token)), eq(publications.state, "published"), sql`${publications.expiresAt} > now()`, isNull(resources.archivedAt), isNull(schema.performanceNotes.expungedAt), eq(resources.ownershipState, "hq"), eq(resources.ownerHqUserId, publications.ownerHqUserId),
        sql`exists(select 1 from alliance_memberships pm join roles pr on pr.id = pm.role_id join role_permissions pp on pp.role_id = pr.id and pp.permission_id = 'notes:publish' where pm.hq_user_id = ${publications.ownerHqUserId} and pm.alliance_id = ${publications.allianceId} and pm.status = 'active' and pr.name in ('owner','maintainer','officer') and exists(select 1 from role_permissions pp_read where pp_read.role_id = pr.id and pp_read.permission_id = 'notes:read') and exists(select 1 from role_permissions pp_members where pp_members.role_id = pr.id and pp_members.permission_id = 'members:read'))`));
    return row ? { title: row.title, body: row.body, locale: row.locale, version: row.version, expiresAt: row.expiresAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null } : null;
  } catch { return null; }
}
