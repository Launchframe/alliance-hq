import "server-only";

import { and, count, desc, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { KnowledgeActor } from "@/lib/notes/policy.shared";
import { knowledgeAccessCondition, KnowledgeAccessError, lockKnowledgeResource, recheckKnowledgeActor, touchKnowledgeResource } from "@/lib/notes/resources.server";
import { normalizeTaskPriority } from "@/lib/notes/tasks.shared";
import type {
  OfficerActionItemPriority,
  OfficerActionItemRecord,
  OfficerActionItemStatus,
  OfficerMeetingNoteStatus,
  OfficerMeetingNoteSummary,
} from "@/lib/officer-intel/synthesis-types.shared";
import { redactOfficerChatMessage } from "@/lib/officer-intel/types.shared";
import type {
  OfficerChatImportMessageInput,
  OfficerChatSessionStatus,
  OfficerChatSessionSummary,
} from "@/lib/officer-intel/types.shared";
import { redactIntakeText } from "@/lib/notes/intake.shared";
import {
  deactivateOfficerActionItemDueInboxItem,
  materializeOfficerActionItemDueInboxItem,
} from "@/lib/officer-intel/action-item-inbox.server";
import {
  dropOfficerActionItemChunks,
} from "@/lib/officer-intel/embed-corpus.server";
import {
  extensionForOfficerIntelMime,
  officerIntelImageStorageKey,
} from "@/lib/officer-intel/storage.shared";
import { deleteObject, putObject } from "@/lib/storage";

function sourceAccess(actor: KnowledgeActor, sessionId: string | SQLWrapper, access: "read" | "share" = "read") {
  return sql`exists (select 1 from officer_chat_sessions source where source.id = ${sessionId} and source.alliance_id = ${actor.allianceId} and ${knowledgeAccessCondition(actor, sql`source.resource_id`, access)})`;
}

export async function createOfficerChatSession(input: {
  actor: KnowledgeActor;
  allianceId: string;
  title: string;
  channelLabel?: string | null;
  sessionAt?: Date | null;
  createdByHqUserId: string | null;
}) {
  const db = getDb();
  const id = nanoid();
  const now = new Date();
  await db.transaction(async (tx) => {
    await recheckKnowledgeActor(tx, input.actor);
    if (input.actor.kind !== "web" || !input.actor.isOfficer || input.actor.allianceId !== input.allianceId || input.actor.hqUserId !== input.createdByHqUserId) throw new KnowledgeAccessError("forbidden");
    await tx.insert(schema.officerChatSessions).values({
      id,
      allianceId: input.allianceId,
      title: input.title,
      channelLabel: input.channelLabel ?? null,
      sessionAt: input.sessionAt ?? null,
      status: "draft",
      createdByHqUserId: input.createdByHqUserId,
      createdAt: now,
      updatedAt: now,
    });
  });
  return id;
}

export async function getOfficerChatSessionForAlliance(input: {
  sessionId: string;
  allianceId: string;
  actor: KnowledgeActor;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerChatSessions)
    .where(
      and(
        eq(schema.officerChatSessions.id, input.sessionId),
        eq(schema.officerChatSessions.allianceId, input.allianceId),
        knowledgeAccessCondition(input.actor, schema.officerChatSessions.resourceId),
      ),
    )
    .limit(1);
  return row ? { ...row, title: redactIntakeText(row.title), channelLabel: row.channelLabel === null ? null : redactIntakeText(row.channelLabel) } : null;
}

export async function listOfficerChatSessions(
  allianceId: string,
  actor: KnowledgeActor,
): Promise<OfficerChatSessionSummary[]> {
  const db = getDb();
  const sessions = await db
    .select()
    .from(schema.officerChatSessions)
    .where(and(eq(schema.officerChatSessions.allianceId, allianceId), knowledgeAccessCondition(actor, schema.officerChatSessions.resourceId)))
    .orderBy(desc(schema.officerChatSessions.updatedAt))
    .limit(50);

  const summaries: OfficerChatSessionSummary[] = [];
  for (const session of sessions) {
    const [messageCountRow] = await db
      .select({ value: count() })
      .from(schema.officerChatMessages)
      .where(eq(schema.officerChatMessages.sessionId, session.id));
    const [imageCountRow] = await db
      .select({ value: count() })
      .from(schema.officerChatSessionImages)
      .where(eq(schema.officerChatSessionImages.sessionId, session.id));

    summaries.push({
      id: session.id,
      title: redactIntakeText(session.title),
      channelLabel: session.channelLabel === null ? null : redactIntakeText(session.channelLabel),
      sessionAt: session.sessionAt?.toISOString() ?? null,
      status: session.status as OfficerChatSessionStatus,
      messageCount: Number(messageCountRow?.value ?? 0),
      imageCount: Number(imageCountRow?.value ?? 0),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    });
  }

  return summaries;
}

export async function listOfficerChatMessages(input: {
  sessionId: string;
  allianceId: string;
  actor: KnowledgeActor;
}) {
  const db = getDb();
  return db
    .select()
    .from(schema.officerChatMessages)
    .where(
      and(
        eq(schema.officerChatMessages.sessionId, input.sessionId),
        eq(schema.officerChatMessages.allianceId, input.allianceId),
        sourceAccess(input.actor, schema.officerChatMessages.sessionId),
      ),
    )
    .orderBy(schema.officerChatMessages.sequenceOrder)
    .then((rows) => rows.map(redactOfficerChatMessage));
}

export async function listOfficerChatSessionImages(input: {
  sessionId: string;
  allianceId: string;
  actor: KnowledgeActor;
}) {
  const db = getDb();
  return db
    .select()
    .from(schema.officerChatSessionImages)
    .where(
      and(
        eq(schema.officerChatSessionImages.sessionId, input.sessionId),
        eq(schema.officerChatSessionImages.allianceId, input.allianceId),
        sourceAccess(input.actor, schema.officerChatSessionImages.sessionId, "share"),
      ),
    )
    .orderBy(schema.officerChatSessionImages.sequenceOrder);
}

export async function importOfficerChatSession(input: {
  actor: KnowledgeActor;
  sessionId: string;
  allianceId: string;
  hqLocale: string;
  title?: string;
  channelLabel?: string | null;
  sessionAt?: Date | null;
  messages: OfficerChatImportMessageInput[];
  images: Array<{
    buffer: Buffer;
    mimeType: string;
    width?: number | null;
    height?: number | null;
  }>;
}) {
  const db = getDb();
  const session = await getOfficerChatSessionForAlliance({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    actor: input.actor,
  });
  if (!session) {
    return { error: "Session not found." as const };
  }

  const previousImages = await listOfficerChatSessionImages({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    actor: input.actor,
  });
  const reservation = await db.transaction(async (tx) => {
    const resource = await lockKnowledgeResource(tx, input.actor, session.resourceId, "share");
    const [current] = await tx.select().from(schema.officerChatSessions).where(eq(schema.officerChatSessions.id, session.id));
    if (current.status === "imported") throw new KnowledgeAccessError("changed");
    return resource.version;
  });
  const localizedMessages = input.messages.map((message) => ({
    message,
    locale: { localeText: message.originalText, localeCode: "und" },
  }));

  const stagedImages: Array<{
    id: string;
    storageKey: string;
    sequenceOrder: number;
    width: number | null;
    height: number | null;
  }> = [];
  const uploadedStorageKeys: string[] = [];
  for (let index = 0; index < input.images.length; index += 1) {
    const image = input.images[index]!;
    const imageId = nanoid();
    const storageKey = officerIntelImageStorageKey({
      allianceId: input.allianceId,
      sessionId: input.sessionId,
      imageId,
      extension: extensionForOfficerIntelMime(image.mimeType),
    });
    stagedImages.push({
      id: imageId,
      storageKey,
      sequenceOrder: index,
      width: image.width ?? null,
      height: image.height ?? null,
    });
  }

  try {
    for (let index = 0; index < input.images.length; index += 1) {
      const storageKey = stagedImages[index]!.storageKey;
      await putObject(storageKey, input.images[index]!.buffer);
      uploadedStorageKeys.push(storageKey);
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      const resource = await lockKnowledgeResource(tx, input.actor, session.resourceId, "share");
      if (resource.version !== reservation) throw new KnowledgeAccessError("changed");
      await touchKnowledgeResource(tx, resource.id);
      await tx
        .delete(schema.officerChatMessages)
        .where(
          and(
            eq(schema.officerChatMessages.sessionId, input.sessionId),
            eq(schema.officerChatMessages.allianceId, input.allianceId),
            sourceAccess(input.actor, schema.officerChatMessages.sessionId),
          ),
        );
      await tx
        .delete(schema.officerChatSessionImages)
        .where(
          and(
            eq(schema.officerChatSessionImages.sessionId, input.sessionId),
            eq(schema.officerChatSessionImages.allianceId, input.allianceId),
            sourceAccess(input.actor, schema.officerChatSessionImages.sessionId, "share"),
          ),
        );

      for (const image of stagedImages) {
        await tx.insert(schema.officerChatSessionImages).values({
          ...image,
          sessionId: input.sessionId,
          allianceId: input.allianceId,
        });
      }

      for (const { message, locale } of localizedMessages) {
        await tx.insert(schema.officerChatMessages).values({
          id: nanoid(),
          sessionId: input.sessionId,
          allianceId: input.allianceId,
          senderAllianceTag: message.senderAllianceTag ?? null,
          senderName: message.senderName,
          senderLevel: message.senderLevel ?? null,
          senderVipLevel: message.senderVipLevel ?? null,
          originalText: message.originalText,
          inGameTranslatedText: message.inGameTranslatedText ?? null,
          localeText: locale.localeText,
          localeCode: locale.localeCode,
          isReply: message.isReply ?? false,
          replyToName: message.replyToName ?? null,
          sequenceOrder: message.sequenceOrder,
          sourceImageIndex: message.sourceImageIndex,
        });
      }

      await tx
        .update(schema.officerChatSessions)
        .set({
          title: input.title?.trim() || session.title,
          channelLabel:
            input.channelLabel === undefined
              ? session.channelLabel
              : input.channelLabel,
          sessionAt:
            input.sessionAt === undefined ? session.sessionAt : input.sessionAt,
          status: "imported",
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.officerChatSessions.id, input.sessionId),
            eq(schema.officerChatSessions.allianceId, input.allianceId),
            knowledgeAccessCondition(input.actor, schema.officerChatSessions.resourceId),
          ),
        );
    });
  } catch (error) {
    await Promise.allSettled(uploadedStorageKeys.map((key) => deleteObject(key)));
    throw error;
  }

  await Promise.allSettled(
    previousImages.map((image) => deleteObject(image.storageKey)),
  );

  return { ok: true as const };
}

export async function getOfficerChatSessionImageForAlliance(input: {
  sessionId: string;
  allianceId: string;
  imageId: string;
  actor: KnowledgeActor;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerChatSessionImages)
    .where(
      and(
        eq(schema.officerChatSessionImages.id, input.imageId),
        eq(schema.officerChatSessionImages.sessionId, input.sessionId),
        eq(schema.officerChatSessionImages.allianceId, input.allianceId),
        sourceAccess(input.actor, schema.officerChatSessionImages.sessionId, "share"),
      ),
    )
    .limit(1);
  return row ?? null;
}

function mapMeetingNoteRow(
  row: typeof schema.officerMeetingNotes.$inferSelect,
  canReadSource = false,
  canEdit = false,
): OfficerMeetingNoteSummary {
  return {
    id: row.id,
    sessionId: canReadSource ? row.sessionId : null,
    canEdit,
    summary: redactIntakeText(row.summary),
    keyDecisions: (row.keyDecisions ?? []).map(redactIntakeText),
    openQuestions: (row.openQuestions ?? []).map(redactIntakeText),
    status: row.status as OfficerMeetingNoteStatus,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readableMeetingNote(row: typeof schema.officerMeetingNotes.$inferSelect, actor: KnowledgeActor) {
  const source = await getOfficerChatSessionForAlliance({ sessionId: row.sessionId, allianceId: row.allianceId, actor });
  const [owner] = await getDb().select({ id: schema.knowledgeResources.id }).from(schema.knowledgeResources)
    .where(and(eq(schema.knowledgeResources.id, row.resourceId), knowledgeAccessCondition(actor, schema.knowledgeResources.id, "share")));
  return mapMeetingNoteRow(row, Boolean(source), Boolean(owner));
}

async function loadAssigneeNames(
  allianceId: string,
  memberIds: string[],
): Promise<Map<string, string>> {
  if (memberIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db
    .select({
      id: schema.allianceMembers.id,
      name: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        inArray(schema.allianceMembers.id, memberIds),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.name]));
}

function mapActionItemRow(
  row: typeof schema.officerActionItems.$inferSelect,
  assigneeNames: Map<string, string>,
  version: number,
): OfficerActionItemRecord {
  return {
    id: row.id,
    noteId: row.noteId,
    sessionId: row.sessionId,
    title: redactIntakeText(row.title),
    description: row.description === null ? null : redactIntakeText(row.description),
    status: row.status as OfficerActionItemStatus,
    priority: normalizeTaskPriority(row.priority),
    assigneeAllianceMemberId: row.assigneeAllianceMemberId,
    assigneeNameRaw: row.assigneeNameRaw,
    assigneeMemberName: row.assigneeAllianceMemberId
      ? assigneeNames.get(row.assigneeAllianceMemberId) ?? null
      : null,
    dueAt: row.dueAt?.toISOString() ?? null,
    dueHint: row.dueHint,
    completedAt: row.completedAt?.toISOString() ?? null,
    version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function readableActionItems(
  rows: Array<{ item: typeof schema.officerActionItems.$inferSelect; version: number }>,
  names: Map<string, string>,
  actor: KnowledgeActor,
) {
  const noteIds = rows.flatMap((row) => row.item.noteId ? [row.item.noteId] : []);
  const sessionIds = rows.flatMap((row) => row.item.sessionId ? [row.item.sessionId] : []);
  const [notes, sources] = await Promise.all([
    noteIds.length ? getDb().select({ id: schema.officerMeetingNotes.id }).from(schema.officerMeetingNotes).where(and(eq(schema.officerMeetingNotes.allianceId, actor.allianceId), inArray(schema.officerMeetingNotes.id, noteIds), knowledgeAccessCondition(actor, schema.officerMeetingNotes.resourceId))) : [],
    sessionIds.length ? getDb().select({ id: schema.officerChatSessions.id }).from(schema.officerChatSessions).where(and(eq(schema.officerChatSessions.allianceId, actor.allianceId), inArray(schema.officerChatSessions.id, sessionIds), knowledgeAccessCondition(actor, schema.officerChatSessions.resourceId))) : [],
  ]);
  const readableNotes = new Set(notes.map((note) => note.id));
  const readableSources = new Set(sources.map((source) => source.id));
  return rows.map((row) => mapActionItemRow({
    ...row.item,
    noteId: row.item.noteId && readableNotes.has(row.item.noteId) ? row.item.noteId : null,
    sessionId: row.item.sessionId && readableSources.has(row.item.sessionId) ? row.item.sessionId : null,
  }, names, row.version));
}

export async function getOfficerMeetingNoteForAlliance(input: {
  noteId: string;
  allianceId: string;
  actor: KnowledgeActor;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerMeetingNotes)
    .where(
      and(
        eq(schema.officerMeetingNotes.id, input.noteId),
        eq(schema.officerMeetingNotes.allianceId, input.allianceId),
        knowledgeAccessCondition(input.actor, schema.officerMeetingNotes.resourceId),
      ),
    )
    .limit(1);
  return row ? readableMeetingNote(row, input.actor) : null;
}

export async function listApprovedOfficerMeetingNotesForAlliance(
  allianceId: string,
  actor: KnowledgeActor,
): Promise<OfficerMeetingNoteSummary[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.officerMeetingNotes)
    .where(
      and(
        eq(schema.officerMeetingNotes.allianceId, allianceId),
        eq(schema.officerMeetingNotes.status, "approved"),
        knowledgeAccessCondition(actor, schema.officerMeetingNotes.resourceId),
      ),
    )
    .orderBy(desc(schema.officerMeetingNotes.approvedAt));
  return rows.map((row) => mapMeetingNoteRow(row));
}

export async function indexOfficerApprovedNoteCorpus(_input: {
  allianceId: string;
  noteId: string;
}): Promise<void> {
  throw new KnowledgeAccessError("not_configured");
}

export async function getOfficerMeetingNoteBySession(input: {
  sessionId: string;
  allianceId: string;
  actor: KnowledgeActor;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerMeetingNotes)
    .where(
      and(
        eq(schema.officerMeetingNotes.sessionId, input.sessionId),
        eq(schema.officerMeetingNotes.allianceId, input.allianceId),
        knowledgeAccessCondition(input.actor, schema.officerMeetingNotes.resourceId),
      ),
    )
    .limit(1);
  return row ? readableMeetingNote(row, input.actor) : null;
}

export async function listOfficerActionItemsForNote(input: {
  noteId: string;
  allianceId: string;
  actor: KnowledgeActor;
}): Promise<OfficerActionItemRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      item: schema.officerActionItems,
      version: schema.knowledgeResources.version,
    })
    .from(schema.officerActionItems)
    .innerJoin(
      schema.knowledgeResources,
      eq(schema.knowledgeResources.id, schema.officerActionItems.resourceId),
    )
    .where(
      and(
        eq(schema.officerActionItems.noteId, input.noteId),
        eq(schema.officerActionItems.allianceId, input.allianceId),
        knowledgeAccessCondition(input.actor, schema.officerActionItems.resourceId),
      ),
    )
    .orderBy(schema.officerActionItems.createdAt);
  const assigneeNames = await loadAssigneeNames(
    input.allianceId,
    rows
      .map((row) => row.item.assigneeAllianceMemberId)
      .filter((id): id is string => Boolean(id)),
  );
  return readableActionItems(rows, assigneeNames, input.actor);
}

export async function listOpenOfficerActionItems(
  allianceId: string,
  actor: KnowledgeActor,
): Promise<OfficerActionItemRecord[]> {
  const db = getDb();
  const rows = await db
    .select({
      item: schema.officerActionItems,
      version: schema.knowledgeResources.version,
    })
    .from(schema.officerActionItems)
    .innerJoin(
      schema.knowledgeResources,
      eq(schema.knowledgeResources.id, schema.officerActionItems.resourceId),
    )
    .where(
      and(
        eq(schema.officerActionItems.allianceId, allianceId),
        inArray(schema.officerActionItems.status, ["open", "in_progress"]),
        knowledgeAccessCondition(actor, schema.officerActionItems.resourceId),
      ),
    )
    .orderBy(desc(schema.officerActionItems.updatedAt))
    .limit(100);
  const assigneeNames = await loadAssigneeNames(
    allianceId,
    rows
      .map((row) => row.item.assigneeAllianceMemberId)
      .filter((id): id is string => Boolean(id)),
  );
  return readableActionItems(rows, assigneeNames, actor);
}

export async function countOpenOfficerActionItems(
  allianceId: string,
  actor: KnowledgeActor,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(schema.officerActionItems)
    .where(
      and(
        eq(schema.officerActionItems.allianceId, allianceId),
        inArray(schema.officerActionItems.status, ["open", "in_progress"]),
        knowledgeAccessCondition(actor, schema.officerActionItems.resourceId),
      ),
    );
  return Number(row?.value ?? 0);
}

export async function persistOfficerSynthesisResult(input: {
  actor: KnowledgeActor;
  expectedSourceVersion: number;
  sessionId: string;
  allianceId: string;
  hqUserId: string | null;
  modelId: string;
  summary: string;
  keyDecisions: string[];
  openQuestions: string[];
  actionItems: Array<{
    title: string;
    description: string | null;
    priority: OfficerActionItemPriority;
    assigneeAllianceMemberId: string | null;
    assigneeNameRaw: string | null;
    dueAt: Date | null;
    dueHint: string | null;
  }>;
}): Promise<
  | { noteId: string }
  | { error: "not_found" | "approved" }
> {
  const session = await getOfficerChatSessionForAlliance({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    actor: input.actor,
  });
  if (!session) {
    return { error: "not_found" };
  }

  const existing = await getOfficerMeetingNoteBySession({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    actor: input.actor,
  });
  if (existing?.status === "approved") {
    return { error: "approved" };
  }

  const db = getDb();
  const now = new Date();
  const noteId = existing?.id ?? nanoid();
  const previousItems =
    existing != null
      ? await listOfficerActionItemsForNote({
          noteId: existing.id,
          allianceId: input.allianceId,
          actor: input.actor,
        })
      : [];

  await db.transaction(async (tx) => {
    const sourceResource = await lockKnowledgeResource(tx, input.actor, session.resourceId, "share");
    if (!sourceResource.knowledgeAiAllowed || sourceResource.version !== input.expectedSourceVersion) throw new KnowledgeAccessError("changed");
    await touchKnowledgeResource(tx, sourceResource.id);
    if (existing) {
      const [note] = await tx.select().from(schema.officerMeetingNotes).where(eq(schema.officerMeetingNotes.id, existing.id));
      await lockKnowledgeResource(tx, input.actor, note.resourceId, "share");
      if (note.status === "approved") throw new KnowledgeAccessError("changed");
      await touchKnowledgeResource(tx, note.resourceId);
      await tx
        .update(schema.officerMeetingNotes)
        .set({
          summary: input.summary,
          keyDecisions: input.keyDecisions,
          openQuestions: input.openQuestions,
          status: "draft",
          synthesizedByHqUserId: input.hqUserId,
          approvedByHqUserId: null,
          approvedAt: null,
          modelId: input.modelId,
          updatedAt: now,
        })
        .where(eq(schema.officerMeetingNotes.id, existing.id));
    } else {
      await tx.insert(schema.officerMeetingNotes).values({
        id: noteId,
        allianceId: input.allianceId,
        sessionId: input.sessionId,
        summary: input.summary,
        keyDecisions: input.keyDecisions,
        openQuestions: input.openQuestions,
        status: "draft",
        synthesizedByHqUserId: input.hqUserId,
        modelId: input.modelId,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const item of existing ? [] : input.actionItems) {
      await tx.insert(schema.officerActionItems).values({
        id: nanoid(),
        allianceId: input.allianceId,
        noteId,
        sessionId: input.sessionId,
        title: item.title,
        description: item.description,
        status: "open",
        priority: item.priority,
        assigneeAllianceMemberId: item.assigneeAllianceMemberId,
        assigneeNameRaw: item.assigneeNameRaw,
        dueAt: item.dueAt,
        dueHint: item.dueHint,
        createdByHqUserId: input.hqUserId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await tx
      .update(schema.officerChatSessions)
      .set({ updatedAt: now })
      .where(eq(schema.officerChatSessions.id, input.sessionId));
  });

  await Promise.all(
    previousItems.map((item) =>
      deactivateOfficerActionItemDueInboxItem(item.id),
    ),
  );

  const savedItems = await listOfficerActionItemsForNote({
    noteId,
    allianceId: input.allianceId,
    actor: input.actor,
  });
  await Promise.all(
    savedItems
      .filter((item) => item.dueAt)
      .map((item) =>
        materializeOfficerActionItemDueInboxItem({
          allianceId: input.allianceId,
          actionItemId: item.id,
          title: item.title,
          dueAt: new Date(item.dueAt!),
        }),
      ),
  );

  await Promise.all(
    previousItems.map((item) =>
      dropOfficerActionItemChunks({
        allianceId: input.allianceId,
        actionItemId: item.id,
      }),
    ),
  );

  return { noteId };
}

export async function updateOfficerMeetingNote(input: {
  actor: KnowledgeActor;
  noteId: string;
  allianceId: string;
  hqUserId: string | null;
  summary?: string;
  keyDecisions?: string[];
  openQuestions?: string[];
  approve?: boolean;
}): Promise<{ ok: true } | { error: "not_found" }> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.officerMeetingNotes)
    .where(
      and(
        eq(schema.officerMeetingNotes.id, input.noteId),
        eq(schema.officerMeetingNotes.allianceId, input.allianceId),
        knowledgeAccessCondition(input.actor, schema.officerMeetingNotes.resourceId),
      ),
    )
    .limit(1);
  if (!existing) {
    return { error: "not_found" };
  }

  await db.transaction(async (tx) => {
    const resource = await lockKnowledgeResource(tx, input.actor, existing.resourceId, "share");
    await tx.update(schema.officerMeetingNotes).set({
      summary: input.summary ?? existing.summary,
      keyDecisions: input.keyDecisions ?? existing.keyDecisions,
      openQuestions: input.openQuestions ?? existing.openQuestions,
      ...(input.approve ? { status: "approved", approvedByHqUserId: input.actor.hqUserId, approvedAt: new Date() } : {}),
      updatedAt: new Date(),
    }).where(eq(schema.officerMeetingNotes.id, input.noteId));
    await touchKnowledgeResource(tx, resource.id);
  });

  return { ok: true };
}

export async function updateOfficerActionItem(input: {
  actor: KnowledgeActor;
  actionItemId: string;
  allianceId: string;
  expectedVersion: number;
  title?: string;
  description?: string | null;
  status?: OfficerActionItemStatus;
  priority?: OfficerActionItemPriority;
  assigneeAllianceMemberId?: string | null;
  dueAt?: Date | null;
  dueHint?: string | null;
}): Promise<{ ok: true; item: OfficerActionItemRecord } | { error: "not_found" }> {
  if (input.actor.allianceId !== input.allianceId) return { error: "not_found" };
  const { getNoteTask, updateNoteTask } = await import("@/lib/notes/tasks.server");
  const current = await getNoteTask(input.actor, input.actionItemId, "edit");
  if (!current) return { error: "not_found" };
  await updateNoteTask(input.actor, input.actionItemId, {
    expectedVersion: input.expectedVersion, title: input.title, description: input.description,
    status: input.status, priority: input.priority, legacyAssigneeAllianceMemberId: input.assigneeAllianceMemberId,
    dueAt: input.dueAt === undefined ? undefined : input.dueAt?.toISOString() ?? null, dueHint: input.dueHint,
  });
  const item = await getOfficerActionItemForAlliance(input);
  return item ? { ok: true, item } : { error: "not_found" };
}

export async function getOfficerActionItemForAlliance(input: {
  actionItemId: string;
  allianceId: string;
  actor: KnowledgeActor;
}) {
  const db = getDb();
  const [row] = await db
    .select({
      item: schema.officerActionItems,
      version: schema.knowledgeResources.version,
    })
    .from(schema.officerActionItems)
    .innerJoin(
      schema.knowledgeResources,
      eq(schema.knowledgeResources.id, schema.officerActionItems.resourceId),
    )
    .where(
      and(
        eq(schema.officerActionItems.id, input.actionItemId),
        eq(schema.officerActionItems.allianceId, input.allianceId),
        knowledgeAccessCondition(input.actor, schema.officerActionItems.resourceId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const names = await loadAssigneeNames(
    input.allianceId,
    row.item.assigneeAllianceMemberId ? [row.item.assigneeAllianceMemberId] : [],
  );
  return (await readableActionItems([row], names, input.actor))[0];
}

export async function indexOfficerOpenActionItemById(input: {
  allianceId: string;
  actionItemId: string;
}): Promise<void> {
  await dropOfficerActionItemChunks(input);
}
