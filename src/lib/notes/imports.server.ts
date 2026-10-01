import "server-only";

import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { deleteObject, putObject, r2Configured } from "@/lib/storage";
import { abortR2MultipartUpload, presignR2PutObject } from "@/lib/storage/r2";
import type { KnowledgeWebActor } from "./access.server";
import { createKnowledgeResource, knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, recheckKnowledgeActor, touchKnowledgeResource, type KnowledgeTransaction } from "./resources.server";
import { knowledgeHash, knowledgePrincipalKey, withKnowledgeReceipt } from "./mutations.server";
import { assertHistoryStorage, historyByteHash, readHistoryObject, readHistoryStream, validateHistoryBytes } from "./import-storage.server";
import { HISTORY_IMPORT_PAGE_SIZE, historyInitSchema, historyReviewSchema, type HistoryImportDetail, type HistoryImportPage, type HistoryInit, type HistoryListCursor, type HistoryMessageMediaDto } from "./imports.shared";
import { redactIntakeText } from "./intake.shared";
import { historyMemberMayProcess, queueHistoryJob } from "./jobs.server";

const imports = schema.knowledgeHistoryImports;
const assets = schema.knowledgeHistoryAssets;
const messages = schema.officerChatMessages;
const media = schema.officerChatMessageMedia;
const ownerResource = (actor: KnowledgeWebActor) => sql`exists(select 1 from knowledge_resources kr where kr.id = ${imports.resourceId} and kr.alliance_id = ${actor.allianceId} and kr.ownership_state = 'hq' and kr.owner_hq_user_id = ${actor.hqUserId} and kr.archived_at is null)`;
const ownerAccess = (actor: KnowledgeWebActor) => and(eq(imports.allianceId, actor.allianceId), ownerResource(actor));
const readableAccess = (actor: KnowledgeWebActor) => and(eq(imports.allianceId, actor.allianceId), sql`exists(select 1 from knowledge_resources where id = ${imports.resourceId} and archived_at is null)`,
  or(ownerResource(actor), and(eq(imports.state, "committed"), knowledgeAccessCondition(actor, imports.resourceId, "read"))));

export async function getHistoryImport(actor: KnowledgeWebActor, id: string) {
  const [row] = await getDb().select().from(imports).where(and(eq(imports.id, id), readableAccess(actor)));
  if (!row) throw new KnowledgeAccessError("not_found");
  return row;
}
export async function getOwnedHistoryImport(actor: KnowledgeWebActor, id: string) {
  const [row] = await getDb().select().from(imports).where(and(eq(imports.id, id), ownerAccess(actor)));
  if (!row) throw new KnowledgeAccessError("not_found");
  return row;
}
export async function lockHistoryImport(tx: KnowledgeTransaction, actor: KnowledgeWebActor, id: string) {
  await recheckKnowledgeActor(tx, actor);
  const [existing] = await tx.select().from(imports).where(and(eq(imports.id, id), ownerAccess(actor)));
  if (!existing) throw new KnowledgeAccessError("not_found");
  if (!await historyMemberMayProcess(tx, { allianceId: actor.allianceId, ownerHqUserId: actor.hqUserId! })) throw new KnowledgeAccessError("forbidden");
  const resource = await lockKnowledgeResource(tx, actor, existing.resourceId, "share");
  if (resource.archivedAt) throw new KnowledgeAccessError("not_found");
  const [record] = await tx.select().from(imports).where(and(eq(imports.id, id), eq(imports.allianceId, actor.allianceId)));
  return { record, resource };
}
export async function historyImportDetail(actor: KnowledgeWebActor, id: string, offset = 0): Promise<HistoryImportDetail> {
  const record = await getHistoryImport(actor, id);
  const db = getDb();
  const [source] = await db.select({ title: schema.officerChatSessions.title, version: schema.knowledgeResources.version }).from(schema.officerChatSessions)
    .innerJoin(schema.knowledgeResources, eq(schema.knowledgeResources.id, schema.officerChatSessions.resourceId)).where(eq(schema.officerChatSessions.id, record.id));
  const [owned] = await db.select({ id: imports.id }).from(imports).where(and(eq(imports.id, id), ownerAccess(actor)));
  const files = await db.select().from(assets).where(and(eq(assets.importId, id), eq(assets.allianceId, actor.allianceId))).orderBy(assets.position);
  const [totals] = await db.select({ total: count(), reviewed: sql<number>`count(*) filter (where history_reviewed)` }).from(messages).where(and(eq(messages.sessionId, id), eq(messages.allianceId, actor.allianceId)));
  const [job] = await db.select().from(schema.knowledgeProcessingJobs).where(and(eq(schema.knowledgeProcessingJobs.importId, id), eq(schema.knowledgeProcessingJobs.allianceId, actor.allianceId)));
  const rows = await db.select().from(messages).where(and(eq(messages.sessionId, id), eq(messages.allianceId, actor.allianceId))).orderBy(messages.sequenceOrder).limit(50).offset(offset);
  const mediaRows = rows.length ? await db.select().from(media).where(and(eq(media.sessionId, id), eq(media.allianceId, actor.allianceId), inArray(media.messageId, rows.map((row) => row.id)))).orderBy(media.sequenceOrder) : [];
  const sessionMedia = await db.select().from(media).where(and(eq(media.sessionId, id), eq(media.allianceId, actor.allianceId), isNull(media.messageId))).orderBy(media.sequenceOrder);
  const [videoJob] = owned && record.sourceVideoJobId
    ? await db.select({ id: schema.videoJobs.id, status: schema.videoJobs.status, errorMessage: schema.videoJobs.errorMessage }).from(schema.videoJobs).where(eq(schema.videoJobs.id, record.sourceVideoJobId))
    : [];
  const legacyImages = owned && !files.length
    ? await db.select({ id: schema.officerChatSessionImages.id }).from(schema.officerChatSessionImages)
        .where(and(eq(schema.officerChatSessionImages.sessionId, id), eq(schema.officerChatSessionImages.allianceId, actor.allianceId))).orderBy(schema.officerChatSessionImages.sequenceOrder)
    : [];
  await getHistoryImport(actor, id);
  const mediaDto = (item: typeof media.$inferSelect): HistoryMessageMediaDto => ({ id: item.id, kind: item.kind, contentType: item.contentType, width: item.width, height: item.height, reviewed: item.reviewed, thumbnailHref: `/api/notes/imports/${id}/media/${item.id}?variant=thumbnail`, fullHref: `/api/notes/imports/${id}/media/${item.id}` });
  return { scope: `${actor.allianceId}:${actor.hqUserId}`, id, title: redactIntakeText(source.title), version: source.version, kind: record.kind, state: record.state, audience: record.audience, owned: !!owned, editable: !!owned, updatedAt: record.updatedAt.toISOString(),
    total: Number(totals.total), reviewed: Number(totals.reviewed), cursor: job?.cursor ?? 0, attempts: job?.attempts ?? 0, errorCode: job?.errorCode ?? null,
    files: files.map((file) => ({ id: file.id, name: redactIntakeText(file.name), contentType: file.contentType, size: file.size, sha256: file.sha256, sealed: !!file.sealedKey, viewHref: file.sealedKey ? `/api/notes/imports/${id}/assets/${file.id}/view` : null })), offset,
    messages: rows.map((row) => {
      const original = redactIntakeText(row.originalText), english = redactIntakeText(row.localeText);
      return { id: row.id, sender: row.senderName === null ? null : redactIntakeText(row.senderName), sentAt: row.sentAt?.toISOString() ?? null, body: english, originalText: original, englishText: english, sourceImageIndex: row.sourceImageIndex,
        included: row.historyIncluded, reviewed: row.historyReviewed, position: row.sequenceOrder,
        isReply: row.isReply, replyToName: row.replyToName === null ? null : redactIntakeText(row.replyToName), replyToMessageId: row.replyToMessageId, replyMatchConfidence: row.replyMatchConfidence,
        coordinates: row.coordinates ?? null, extractionConfidence: row.extractionConfidence, reviewReasons: row.reviewReasons,
        media: mediaRows.filter((item) => item.messageId === row.id).map(mediaDto) };
    }),
    sessionMedia: sessionMedia.map(mediaDto),
    evidence: legacyImages.map((image) => ({ id: image.id, href: `/api/officer-intel/sessions/${id}/images/${image.id}` })),
    videoJob: videoJob ?? null,
  };
}
export async function listHistoryImports(actor: KnowledgeWebActor, cursor: HistoryListCursor | null = null): Promise<HistoryImportPage> {
  const scope = `${actor.allianceId}:${actor.hqUserId}`;
  if (cursor && cursor.scope !== scope) throw new KnowledgeAccessError("forbidden");
  const backwards = cursor?.direction === "previous", order = backwards ? asc : desc, comparison = backwards ? sql`>` : sql`<`;
  const rows = await getDb().select({ record: imports, title: schema.officerChatSessions.title, owned: sql<boolean>`${ownerResource(actor)}`, cursorTime: sql<string>`to_char(${imports.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` }).from(imports)
    .innerJoin(schema.officerChatSessions, eq(schema.officerChatSessions.id, imports.id))
    .where(and(readableAccess(actor), cursor ? sql`(${imports.updatedAt}, ${imports.id}) ${comparison} (${cursor.updatedAt}::text::timestamptz, ${cursor.id})` : undefined))
    .orderBy(order(imports.updatedAt), order(imports.id)).limit(HISTORY_IMPORT_PAGE_SIZE + 1);
  const page = rows.slice(0, HISTORY_IMPORT_PAGE_SIZE);
  if (backwards) page.reverse();
  const makeCursor = (row: typeof rows[number] | undefined, direction: "next" | "previous") => row ? JSON.stringify({ version: 1, scope, id: row.record.id, updatedAt: row.cursorTime, direction } satisfies HistoryListCursor) : null;
  return { scope, imports: page.map(({ record, title, owned, cursorTime }) => ({ id: record.id, title: redactIntakeText(title), state: record.state, kind: record.kind, audience: record.audience, owned, updatedAt: cursorTime })),
    nextCursor: (backwards ? !!cursor : rows.length > HISTORY_IMPORT_PAGE_SIZE) ? makeCursor(page.at(-1), "next") : null,
    previousCursor: (backwards ? rows.length > HISTORY_IMPORT_PAGE_SIZE : !!cursor) ? makeCursor(page[0], "previous") : null };
}
export async function initializeHistoryImport(actor: KnowledgeWebActor, raw: HistoryInit) {
  if (!actor.canCreate || !actor.hqUserId) throw new KnowledgeAccessError("forbidden");
  assertHistoryStorage();
  const input = historyInitSchema.parse(raw);
  if (input.expectedScope !== `${actor.allianceId}:${actor.hqUserId}`) throw new KnowledgeAccessError("forbidden");
  const sourceHash = knowledgeHash([1, input.kind, input.audience, input.files.map((file) => file.sha256)]);
  return withKnowledgeReceipt(actor, "notes.import_create", input.requestId, input, async (tx) => {
    if (!await historyMemberMayProcess(tx, { allianceId: actor.allianceId, ownerHqUserId: actor.hqUserId! })) throw new KnowledgeAccessError("forbidden");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`history:${actor.allianceId}:${knowledgePrincipalKey(actor)}`}, 0))`);
    const [existing] = await tx.select({ id: imports.id }).from(imports).where(and(ownerAccess(actor), eq(imports.sourceHash, sourceHash), inArray(imports.state, ["uploading", "queued", "processing", "pending_approval", "review", "failed"]))).limit(1);
    if (existing) return { importId: existing.id };
    const [daily] = await tx.select({ value: count() }).from(imports).where(and(ownerAccess(actor), gt(imports.createdAt, new Date(Date.now() - 86_400_000))));
    const [pending] = await tx.select({ value: count() }).from(imports).where(and(ownerAccess(actor), inArray(imports.state, ["uploading", "queued", "processing", "pending_approval", "review", "failed"])));
    if (Number(daily.value) >= 20 || Number(pending.value) >= 5) throw new KnowledgeAccessError("rate_limited");
    const id = nanoid();
    const resourceId = await createKnowledgeResource(tx, actor, "source", id);
    await tx.insert(schema.officerChatSessions).values({ id, allianceId: actor.allianceId, resourceId, title: redactIntakeText(input.title), createdByHqUserId: actor.hqUserId });
    await tx.insert(imports).values({ id, allianceId: actor.allianceId, resourceId, kind: input.kind, locale: input.locale, audience: input.audience, sourceHash });
    await tx.insert(assets).values(input.files.map((file, position) => ({ ...file, id: nanoid(), importId: id, allianceId: actor.allianceId, position, stagingKey: `notes-history/${id}/staging/${nanoid()}` })));
    return { importId: id };
  });
}
async function uploadAsset(actor: KnowledgeWebActor, id: string, assetId: string) {
  if (!actor.canCreate) throw new KnowledgeAccessError("forbidden");
  const record = await getOwnedHistoryImport(actor, id);
  const [asset] = await getDb().select().from(assets).where(and(eq(assets.id, assetId), eq(assets.importId, id), eq(assets.allianceId, actor.allianceId)));
  if (!asset) throw new KnowledgeAccessError("not_found");
  return { record, asset };
}
export async function historyUploadTarget(actor: KnowledgeWebActor, id: string, assetId: string) {
  assertHistoryStorage();
  const { record, asset } = await uploadAsset(actor, id, assetId);
  if (record.state !== "uploading" || asset.sealedKey) throw new KnowledgeAccessError("changed");
  return { url: r2Configured() ? await presignR2PutObject(asset.stagingKey, asset.contentType, 300, asset.size) : `/api/notes/imports/${id}/assets/${assetId}`, contentType: asset.contentType };
}
export async function putLocalHistoryAsset(actor: KnowledgeWebActor, id: string, assetId: string, request: Request) {
  assertHistoryStorage();
  if (r2Configured()) throw new KnowledgeAccessError("forbidden");
  const { record, asset } = await uploadAsset(actor, id, assetId);
  if (record.state !== "uploading" || asset.sealedKey) throw new KnowledgeAccessError("changed");
  if (request.headers.get("content-type")?.split(";")[0].trim() !== asset.contentType) throw new KnowledgeAccessError("invalid");
  const bytes = await readHistoryStream(request.body, asset.size);
  if (bytes.length !== asset.size || historyByteHash(bytes) !== asset.sha256) throw new KnowledgeAccessError("invalid");
  validateHistoryBytes(bytes, asset.contentType);
  await putObject(asset.stagingKey, bytes);
}
export async function sealHistoryAsset(actor: KnowledgeWebActor, id: string, assetId: string) {
  const { record, asset } = await uploadAsset(actor, id, assetId);
  if (asset.sealedKey) return;
  if (record.state !== "uploading") throw new KnowledgeAccessError("changed");
  const bytes = await readHistoryObject(asset.stagingKey, asset.size, asset.contentType, asset.sha256, true);
  const key = `notes-history/${id}/sealed/${nanoid()}`;
  await putObject(key, bytes);
  let retained: boolean | null = null;
  try {
    retained = await getDb().transaction(async (tx) => {
      const { record: current } = await lockHistoryImport(tx, actor, id);
      if (current.state !== "uploading") throw new KnowledgeAccessError("changed");
      const saved = await tx.update(assets).set({ sealedKey: key, sealedAt: new Date() }).where(and(eq(assets.id, assetId), eq(assets.importId, id), isNull(assets.sealedKey))).returning({ id: assets.id });
      return saved.length === 1;
    });
  } catch (error) {
    if (error instanceof KnowledgeAccessError && (error.code === "changed" || error.code === "forbidden" || error.code === "not_found")) retained = false;
    throw error;
  } finally { if (retained === false) await deleteObject(key); }
}
export async function commandHistoryImport(actor: KnowledgeWebActor, id: string, input: { requestId: string; expectedVersion: number; command: "finalize" | "commit" | "cancel" | "retry" }) {
  if (!actor.canCreate) throw new KnowledgeAccessError("forbidden");
  let cleanup: Array<{ storageKey: string | null; uploadId: string | null }> = [];
  const result = await withKnowledgeReceipt(actor, `notes.import_${input.command}`, input.requestId, { id, ...input }, async (tx) => {
    const { record, resource } = await lockHistoryImport(tx, actor, id);
    if (input.command === "commit" && record.state === "committed" || input.command === "finalize" && ["queued", "processing", "review", "committed"].includes(record.state)) return { importId: id };
    if (resource.version !== input.expectedVersion) throw new KnowledgeAccessError("changed");
    if (input.command === "commit") {
      if (record.state !== "review") throw new KnowledgeAccessError("changed");
      const [totals] = await tx.select({
        unreviewed: sql<number>`count(*) filter (where history_included and not history_reviewed)`, included: sql<number>`count(*) filter (where history_included)`,
        emptyEnglish: sql<number>`count(*) filter (where history_included and btrim(locale_text) = '')`,
      }).from(messages).where(and(eq(messages.sessionId, id), eq(messages.allianceId, actor.allianceId)));
      const [mediaTotals] = await tx.select({ unreviewed: sql<number>`count(*) filter (where not reviewed)`, reviewed: sql<number>`count(*) filter (where reviewed)` }).from(media).where(and(eq(media.sessionId, id), eq(media.allianceId, actor.allianceId)));
      if (Number(totals.unreviewed) || Number(totals.emptyEnglish) || Number(mediaTotals.unreviewed) || (!Number(totals.included) && !Number(mediaTotals.reviewed))) throw new KnowledgeAccessError("invalid");
      await tx.update(imports).set({ state: "committed", updatedAt: new Date() }).where(eq(imports.id, id));
      await tx.update(schema.officerChatSessions).set({ status: "imported", updatedAt: new Date() }).where(eq(schema.officerChatSessions.id, id));
      if (record.audience === "officers_read") {
        await tx.insert(schema.knowledgeResourceGrants).values({ id: nanoid(), resourceId: record.resourceId, allianceId: actor.allianceId, subjectKind: "officers", subjectId: actor.allianceId, role: "read", createdByHqUserId: actor.hqUserId }).onConflictDoNothing();
      }
    } else if (input.command === "cancel") {
      if (record.state === "committed") throw new KnowledgeAccessError("changed");
      if (record.kind === "video") cleanup = await tx
        .select({ storageKey: schema.videoJobs.storageKey, uploadId: schema.videoJobs.r2UploadId })
        .from(schema.videoJobs)
        .where(and(eq(schema.videoJobs.knowledgeImportId, id), inArray(schema.videoJobs.status, ["pending_upload", "pending_approval", "queued", "extracting", "parsing", "review", "failed"])));
      await tx.update(imports).set({ state: "cancelled", updatedAt: new Date() }).where(eq(imports.id, id));
      await tx.update(schema.knowledgeProcessingJobs).set({ state: "cancelled", leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() }).where(eq(schema.knowledgeProcessingJobs.importId, id));
      await tx.update(schema.videoJobs).set({ status: "discarded", updatedAt: new Date() })
        .where(and(eq(schema.videoJobs.knowledgeImportId, id), inArray(schema.videoJobs.status, ["pending_upload", "pending_approval", "queued", "extracting", "parsing", "review", "failed"])));
    } else {
      if (input.command === "finalize" ? record.state !== "uploading" : !["failed", "cancelled"].includes(record.state)) throw new KnowledgeAccessError("changed");
      const files = await tx.select().from(assets).where(and(eq(assets.importId, id), eq(assets.allianceId, actor.allianceId)));
      if (record.kind === "video" && input.command !== "finalize") {
        const preCommitJobStatuses = ["pending_upload", "pending_approval", "queued", "extracting", "parsing", "review", "failed", "discarded"] as const;
        cleanup = await tx
          .select({ storageKey: schema.videoJobs.storageKey, uploadId: schema.videoJobs.r2UploadId })
          .from(schema.videoJobs)
          .where(and(eq(schema.videoJobs.knowledgeImportId, id), inArray(schema.videoJobs.status, [...preCommitJobStatuses])));
        await tx.update(schema.videoJobs).set({ status: "discarded", knowledgeImportId: null, updatedAt: new Date() })
          .where(and(eq(schema.videoJobs.knowledgeImportId, id), inArray(schema.videoJobs.status, [...preCommitJobStatuses])));
        await tx.update(imports).set({ state: "uploading", sourceVideoJobId: null, updatedAt: new Date() }).where(eq(imports.id, id));
        await tx.update(assets).set({ sealedKey: null, sealedAt: null, r2UploadId: null }).where(and(eq(assets.importId, id), eq(assets.allianceId, actor.allianceId)));
      } else if (!files.length || files.some((file) => !file.sealedKey)) {
        if (input.command !== "retry") throw new KnowledgeAccessError("invalid");
        await tx.update(imports).set({ state: "uploading", updatedAt: new Date() }).where(eq(imports.id, id));
      } else {
        await queueHistoryJob(tx, { importId: id, allianceId: actor.allianceId, ownerHqUserId: actor.hqUserId!, sourceVersion: resource.version + 1, accessVersion: resource.accessVersion });
        await tx.update(imports).set({ state: "queued", updatedAt: new Date() }).where(eq(imports.id, id));
      }
    }
    await touchKnowledgeResource(tx, resource.id);
    return { importId: id };
  });
  for (const target of cleanup) {
    if (target.uploadId && target.storageKey) {
      await abortR2MultipartUpload(target.storageKey, target.uploadId).catch(() => undefined);
    }
    if (target.storageKey) {
      await deleteObject(target.storageKey).catch(() => undefined);
    }
  }
  return result;
}
export async function reviewHistoryMessages(actor: KnowledgeWebActor, id: string, input: { requestId: string; expectedVersion: number; edits: Array<{ id: string } & Record<string, unknown>>; mediaReviews?: Array<{ id: string; reviewed: boolean }> }) {
  if (!actor.canCreate) throw new KnowledgeAccessError("forbidden");
  return withKnowledgeReceipt(actor, "notes.import_review", input.requestId, { id, ...input }, async (tx) => {
    const { record, resource } = await lockHistoryImport(tx, actor, id);
    if (record.state !== "review" || resource.version !== input.expectedVersion) throw new KnowledgeAccessError("changed");
    const mediaReviews = input.mediaReviews ?? [];
    if (!input.edits.length && !mediaReviews.length) throw new KnowledgeAccessError("invalid");
    if (input.edits.length > 50 || new Set(input.edits.map((edit) => edit.id)).size !== input.edits.length) throw new KnowledgeAccessError("invalid");
    if (mediaReviews.length > 100 || new Set(mediaReviews.map((item) => item.id)).size !== mediaReviews.length) throw new KnowledgeAccessError("invalid");
    for (const item of mediaReviews) {
      const saved = await tx.update(media).set({ reviewed: item.reviewed })
        .where(and(eq(media.id, item.id), eq(media.sessionId, id), eq(media.allianceId, actor.allianceId))).returning({ id: media.id });
      if (!saved.length) throw new KnowledgeAccessError("invalid");
    }
    for (const edit of input.edits) {
      const fields = historyReviewSchema.parse({
        ...edit,
        body: typeof edit.body === "string" ? redactIntakeText(edit.body) : edit.body,
        originalText: typeof edit.originalText === "string" ? redactIntakeText(edit.originalText) : edit.originalText,
        englishText: typeof edit.englishText === "string" ? redactIntakeText(edit.englishText) : edit.englishText,
        sender: typeof edit.sender === "string" ? redactIntakeText(edit.sender) : edit.sender,
        replyToName: typeof edit.replyToName === "string" ? redactIntakeText(edit.replyToName) : edit.replyToName,
        expectedVersion: input.expectedVersion,
      });
      const english = fields.englishText ?? fields.body, original = fields.originalText ?? fields.body;
      if (fields.replyToMessageId !== undefined && fields.replyToMessageId !== null) {
        const [current] = await tx.select({ sequenceOrder: messages.sequenceOrder }).from(messages)
          .where(and(eq(messages.id, edit.id), eq(messages.sessionId, id), eq(messages.allianceId, actor.allianceId)));
        if (!current) throw new KnowledgeAccessError("invalid");
        const [target] = await tx.select({ sequenceOrder: messages.sequenceOrder }).from(messages)
          .where(and(eq(messages.id, fields.replyToMessageId), eq(messages.sessionId, id), eq(messages.allianceId, actor.allianceId)));
        if (!target || target.sequenceOrder >= current.sequenceOrder) throw new KnowledgeAccessError("invalid");
      }
      const updates: Partial<typeof messages.$inferInsert> = {
        senderName: fields.sender === undefined ? undefined : fields.sender || null,
        sentAt: fields.sentAt === undefined ? undefined : fields.sentAt ? new Date(fields.sentAt) : null,
        historyIncluded: fields.included, historyReviewed: true,
      };
      if (original !== undefined) updates.originalText = original;
      if (english !== undefined) updates.localeText = english;
      if (fields.replyToMessageId !== undefined) {
        updates.replyToMessageId = fields.replyToMessageId;
        updates.isReply = !!(fields.replyToMessageId ?? fields.replyToName);
      }
      if (fields.replyToName !== undefined) {
        updates.replyToName = fields.replyToName;
        if (fields.replyToMessageId === undefined) updates.isReply = !!fields.replyToName;
      }
      if (fields.coordinates !== undefined) updates.coordinates = fields.coordinates;
      const updated = await tx.update(messages).set(updates)
        .where(and(eq(messages.id, edit.id), eq(messages.sessionId, id), eq(messages.allianceId, actor.allianceId))).returning({ id: messages.id });
      if (!updated.length) throw new KnowledgeAccessError("invalid");
      if (fields.mediaReviewed?.length) {
        for (const item of fields.mediaReviewed) {
          const saved = await tx.update(media).set({ reviewed: item.reviewed })
            .where(and(eq(media.id, item.id), eq(media.sessionId, id), eq(media.allianceId, actor.allianceId))).returning({ id: media.id });
          if (!saved.length) throw new KnowledgeAccessError("invalid");
        }
      }
    }
    await touchKnowledgeResource(tx, resource.id);
    await tx.update(imports).set({ updatedAt: new Date() }).where(eq(imports.id, id));
    return { importId: id };
  });
}

export async function historyAssetTarget(actor: KnowledgeWebActor, id: string, assetId: string) {
  await getHistoryImport(actor, id);
  const [asset] = await getDb().select().from(assets).where(and(eq(assets.id, assetId), eq(assets.importId, id), eq(assets.allianceId, actor.allianceId)));
  if (!asset?.sealedKey) throw new KnowledgeAccessError("not_found");
  return { storageKey: asset.sealedKey, contentType: asset.contentType };
}

export async function historyMediaTarget(actor: KnowledgeWebActor, id: string, mediaId: string, thumbnail: boolean) {
  await getHistoryImport(actor, id);
  const [item] = await getDb().select().from(media).where(and(eq(media.id, mediaId), eq(media.sessionId, id), eq(media.allianceId, actor.allianceId)));
  if (!item) throw new KnowledgeAccessError("not_found");
  const useThumbnail = thumbnail && item.thumbnailStorageKey != null;
  const storageKey = useThumbnail ? item.thumbnailStorageKey! : item.storageKey;
  return { storageKey, contentType: useThumbnail ? "image/webp" : item.contentType };
}
