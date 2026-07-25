import "server-only";

import { and, count, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type {
  OfficerActionItemPriority,
  OfficerActionItemRecord,
  OfficerActionItemStatus,
  OfficerMeetingNoteStatus,
  OfficerMeetingNoteSummary,
} from "@/lib/officer-intel/synthesis-types.shared";
import type {
  OfficerChatImportMessageInput,
  OfficerChatSessionStatus,
  OfficerChatSessionSummary,
} from "@/lib/officer-intel/types.shared";
import { resolveOfficerChatLocaleText } from "@/lib/officer-intel/locale-text.server";
import {
  deactivateOfficerActionItemDueInboxItem,
  materializeOfficerActionItemDueInboxItem,
} from "@/lib/officer-intel/action-item-inbox.server";
import {
  extensionForOfficerIntelMime,
  officerIntelImageStorageKey,
} from "@/lib/officer-intel/storage.shared";
import { deleteObject, putObject } from "@/lib/storage";

export async function createOfficerChatSession(input: {
  allianceId: string;
  title: string;
  channelLabel?: string | null;
  sessionAt?: Date | null;
  createdByHqUserId: string | null;
}) {
  const db = getDb();
  const id = nanoid();
  const now = new Date();
  await db.insert(schema.officerChatSessions).values({
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
  return id;
}

export async function getOfficerChatSessionForAlliance(input: {
  sessionId: string;
  allianceId: string;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerChatSessions)
    .where(
      and(
        eq(schema.officerChatSessions.id, input.sessionId),
        eq(schema.officerChatSessions.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listOfficerChatSessions(
  allianceId: string,
): Promise<OfficerChatSessionSummary[]> {
  const db = getDb();
  const sessions = await db
    .select()
    .from(schema.officerChatSessions)
    .where(eq(schema.officerChatSessions.allianceId, allianceId))
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
      title: session.title,
      channelLabel: session.channelLabel,
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
}) {
  const db = getDb();
  return db
    .select()
    .from(schema.officerChatMessages)
    .where(
      and(
        eq(schema.officerChatMessages.sessionId, input.sessionId),
        eq(schema.officerChatMessages.allianceId, input.allianceId),
      ),
    )
    .orderBy(schema.officerChatMessages.sequenceOrder);
}

export async function listOfficerChatSessionImages(input: {
  sessionId: string;
  allianceId: string;
}) {
  const db = getDb();
  return db
    .select()
    .from(schema.officerChatSessionImages)
    .where(
      and(
        eq(schema.officerChatSessionImages.sessionId, input.sessionId),
        eq(schema.officerChatSessionImages.allianceId, input.allianceId),
      ),
    )
    .orderBy(schema.officerChatSessionImages.sequenceOrder);
}

export async function importOfficerChatSession(input: {
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
  });
  if (!session) {
    return { error: "Session not found." as const };
  }

  const previousImages = await listOfficerChatSessionImages({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
  });
  const localizedMessages: Array<{
    message: OfficerChatImportMessageInput;
    locale: Awaited<ReturnType<typeof resolveOfficerChatLocaleText>>;
  }> = [];
  for (const message of input.messages) {
    const locale = await resolveOfficerChatLocaleText({
      allianceId: input.allianceId,
      originalText: message.originalText,
      hqLocale: input.hqLocale,
    });
    localizedMessages.push({ message, locale });
  }

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
      await tx
        .delete(schema.officerChatMessages)
        .where(
          and(
            eq(schema.officerChatMessages.sessionId, input.sessionId),
            eq(schema.officerChatMessages.allianceId, input.allianceId),
          ),
        );
      await tx
        .delete(schema.officerChatSessionImages)
        .where(
          and(
            eq(schema.officerChatSessionImages.sessionId, input.sessionId),
            eq(schema.officerChatSessionImages.allianceId, input.allianceId),
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
      ),
    )
    .limit(1);
  return row ?? null;
}

function mapMeetingNoteRow(
  row: typeof schema.officerMeetingNotes.$inferSelect,
): OfficerMeetingNoteSummary {
  return {
    id: row.id,
    sessionId: row.sessionId,
    summary: row.summary,
    keyDecisions: row.keyDecisions ?? [],
    openQuestions: row.openQuestions ?? [],
    status: row.status as OfficerMeetingNoteStatus,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
): OfficerActionItemRecord {
  return {
    id: row.id,
    noteId: row.noteId,
    sessionId: row.sessionId,
    title: row.title,
    description: row.description,
    status: row.status as OfficerActionItemStatus,
    priority: row.priority as OfficerActionItemPriority,
    assigneeAllianceMemberId: row.assigneeAllianceMemberId,
    assigneeNameRaw: row.assigneeNameRaw,
    assigneeMemberName: row.assigneeAllianceMemberId
      ? assigneeNames.get(row.assigneeAllianceMemberId) ?? null
      : null,
    dueAt: row.dueAt?.toISOString() ?? null,
    dueHint: row.dueHint,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOfficerMeetingNoteForAlliance(input: {
  noteId: string;
  allianceId: string;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerMeetingNotes)
    .where(
      and(
        eq(schema.officerMeetingNotes.id, input.noteId),
        eq(schema.officerMeetingNotes.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  return row ? mapMeetingNoteRow(row) : null;
}

export async function getOfficerMeetingNoteBySession(input: {
  sessionId: string;
  allianceId: string;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerMeetingNotes)
    .where(
      and(
        eq(schema.officerMeetingNotes.sessionId, input.sessionId),
        eq(schema.officerMeetingNotes.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  return row ? mapMeetingNoteRow(row) : null;
}

export async function listOfficerActionItemsForNote(input: {
  noteId: string;
  allianceId: string;
}): Promise<OfficerActionItemRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.officerActionItems)
    .where(
      and(
        eq(schema.officerActionItems.noteId, input.noteId),
        eq(schema.officerActionItems.allianceId, input.allianceId),
      ),
    )
    .orderBy(schema.officerActionItems.createdAt);
  const assigneeNames = await loadAssigneeNames(
    input.allianceId,
    rows
      .map((row) => row.assigneeAllianceMemberId)
      .filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) => mapActionItemRow(row, assigneeNames));
}

export async function listOpenOfficerActionItems(
  allianceId: string,
): Promise<OfficerActionItemRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.officerActionItems)
    .where(
      and(
        eq(schema.officerActionItems.allianceId, allianceId),
        inArray(schema.officerActionItems.status, ["open", "in_progress"]),
      ),
    )
    .orderBy(desc(schema.officerActionItems.updatedAt))
    .limit(100);
  const assigneeNames = await loadAssigneeNames(
    allianceId,
    rows
      .map((row) => row.assigneeAllianceMemberId)
      .filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) => mapActionItemRow(row, assigneeNames));
}

export async function countOpenOfficerActionItems(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(schema.officerActionItems)
    .where(
      and(
        eq(schema.officerActionItems.allianceId, allianceId),
        inArray(schema.officerActionItems.status, ["open", "in_progress"]),
      ),
    );
  return Number(row?.value ?? 0);
}

export async function persistOfficerSynthesisResult(input: {
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
  });
  if (!session) {
    return { error: "not_found" };
  }

  const existing = await getOfficerMeetingNoteBySession({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
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
        })
      : [];

  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .delete(schema.officerActionItems)
        .where(eq(schema.officerActionItems.noteId, existing.id));
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

    for (const item of input.actionItems) {
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

  return { noteId };
}

export async function updateOfficerMeetingNote(input: {
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
      ),
    )
    .limit(1);
  if (!existing) {
    return { error: "not_found" };
  }

  const now = new Date();
  await db
    .update(schema.officerMeetingNotes)
    .set({
      summary: input.summary ?? existing.summary,
      keyDecisions: input.keyDecisions ?? existing.keyDecisions,
      openQuestions: input.openQuestions ?? existing.openQuestions,
      status: input.approve ? "approved" : existing.status,
      approvedByHqUserId: input.approve
        ? input.hqUserId
        : existing.approvedByHqUserId,
      approvedAt: input.approve ? now : existing.approvedAt,
      updatedAt: now,
    })
    .where(eq(schema.officerMeetingNotes.id, input.noteId));

  return { ok: true };
}

export async function updateOfficerActionItem(input: {
  actionItemId: string;
  allianceId: string;
  title?: string;
  description?: string | null;
  status?: OfficerActionItemStatus;
  priority?: OfficerActionItemPriority;
  assigneeAllianceMemberId?: string | null;
  dueAt?: Date | null;
  dueHint?: string | null;
}): Promise<
  | { ok: true; item: OfficerActionItemRecord }
  | { error: "not_found" }
> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.officerActionItems)
    .where(
      and(
        eq(schema.officerActionItems.id, input.actionItemId),
        eq(schema.officerActionItems.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  if (!existing) {
    return { error: "not_found" };
  }

  const now = new Date();
  const nextStatus = input.status ?? existing.status;
  const nextDueAt =
    input.dueAt === undefined ? existing.dueAt : input.dueAt;
  const completedAt =
    nextStatus === "done" || nextStatus === "cancelled"
      ? (existing.completedAt ?? now)
      : null;

  await db
    .update(schema.officerActionItems)
    .set({
      title: input.title ?? existing.title,
      description:
        input.description === undefined
          ? existing.description
          : input.description,
      status: nextStatus,
      priority: input.priority ?? existing.priority,
      assigneeAllianceMemberId:
        input.assigneeAllianceMemberId === undefined
          ? existing.assigneeAllianceMemberId
          : input.assigneeAllianceMemberId,
      dueAt: nextDueAt,
      dueHint:
        input.dueHint === undefined ? existing.dueHint : input.dueHint,
      completedAt,
      updatedAt: now,
    })
    .where(eq(schema.officerActionItems.id, input.actionItemId));

  if (nextStatus === "done" || nextStatus === "cancelled") {
    await deactivateOfficerActionItemDueInboxItem(input.actionItemId);
  } else if (nextDueAt) {
    await materializeOfficerActionItemDueInboxItem({
      allianceId: input.allianceId,
      actionItemId: input.actionItemId,
      title: input.title ?? existing.title,
      dueAt: nextDueAt,
    });
  } else {
    await deactivateOfficerActionItemDueInboxItem(input.actionItemId);
  }

  const [updated] = await db
    .select()
    .from(schema.officerActionItems)
    .where(eq(schema.officerActionItems.id, input.actionItemId))
    .limit(1);
  if (!updated) {
    return { error: "not_found" };
  }
  const names = await loadAssigneeNames(
    input.allianceId,
    updated.assigneeAllianceMemberId ? [updated.assigneeAllianceMemberId] : [],
  );
  return { ok: true, item: mapActionItemRow(updated, names) };
}

export async function getOfficerActionItemForAlliance(input: {
  actionItemId: string;
  allianceId: string;
}) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.officerActionItems)
    .where(
      and(
        eq(schema.officerActionItems.id, input.actionItemId),
        eq(schema.officerActionItems.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const names = await loadAssigneeNames(
    input.allianceId,
    row.assigneeAllianceMemberId ? [row.assigneeAllianceMemberId] : [],
  );
  return mapActionItemRow(row, names);
}
