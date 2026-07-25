import "server-only";

import { and, count, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type {
  OfficerChatImportMessageInput,
  OfficerChatSessionStatus,
  OfficerChatSessionSummary,
} from "@/lib/officer-intel/types.shared";
import { resolveOfficerChatLocaleText } from "@/lib/officer-intel/locale-text.server";
import {
  extensionForOfficerIntelMime,
  officerIntelImageStorageKey,
} from "@/lib/officer-intel/storage.shared";
import { putObject } from "@/lib/storage";

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

  await db
    .delete(schema.officerChatMessages)
    .where(eq(schema.officerChatMessages.sessionId, input.sessionId));
  await db
    .delete(schema.officerChatSessionImages)
    .where(eq(schema.officerChatSessionImages.sessionId, input.sessionId));

  for (let index = 0; index < input.images.length; index += 1) {
    const image = input.images[index]!;
    const imageId = nanoid();
    const storageKey = officerIntelImageStorageKey({
      allianceId: input.allianceId,
      sessionId: input.sessionId,
      imageId,
      extension: extensionForOfficerIntelMime(image.mimeType),
    });
    await putObject(storageKey, image.buffer);
    await db.insert(schema.officerChatSessionImages).values({
      id: imageId,
      sessionId: input.sessionId,
      allianceId: input.allianceId,
      storageKey,
      sequenceOrder: index,
      width: image.width ?? null,
      height: image.height ?? null,
    });
  }

  for (const message of input.messages) {
    const locale = await resolveOfficerChatLocaleText({
      allianceId: input.allianceId,
      originalText: message.originalText,
      hqLocale: input.hqLocale,
    });
    await db.insert(schema.officerChatMessages).values({
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

  const now = new Date();
  await db
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
    .where(eq(schema.officerChatSessions.id, input.sessionId));

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
