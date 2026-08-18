import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  buildActionItemChunk,
  buildApprovedNoteChunks,
  type OfficerIntelSessionContext,
} from "@/lib/officer-intel/build-corpus-chunks.shared";
import {
  isOfficerIntelLlmConfigured,
  officerIntelEmbedModel,
} from "@/lib/officer-intel/llm-config.server";
import type { OfficerActionItemRecord } from "@/lib/officer-intel/synthesis-types.shared";
import type { OfficerMeetingNoteSummary } from "@/lib/officer-intel/synthesis-types.shared";

let embedSkipLogged = false;

function logEmbedSkipOnce() {
  if (embedSkipLogged) return;
  embedSkipLogged = true;
  console.warn(
    "[officer-intel] OPENAI_API_KEY missing — skipping corpus embeddings.",
  );
}

function toSessionContext(session: {
  title: string;
  channelLabel: string | null;
  sessionAt: Date | null;
}): OfficerIntelSessionContext {
  return {
    title: session.title,
    channelLabel: session.channelLabel,
    sessionAt: session.sessionAt?.toISOString() ?? null,
  };
}

async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!isOfficerIntelLlmConfigured() || texts.length === 0) {
    logEmbedSkipOnce();
    return null;
  }

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { embeddings } = await embedMany({
    model: openai.embedding(officerIntelEmbedModel()),
    values: texts,
  });
  return embeddings;
}

async function deleteChunksForSource(input: {
  allianceId: string;
  sourceType: "approved_note" | "action_item";
  sourceId: string;
}) {
  const db = getDb();
  await db
    .delete(schema.officerIntelChunks)
    .where(
      and(
        eq(schema.officerIntelChunks.allianceId, input.allianceId),
        eq(schema.officerIntelChunks.sourceType, input.sourceType),
        eq(schema.officerIntelChunks.sourceId, input.sourceId),
      ),
    );
}

export async function dropOfficerMeetingNoteChunks(noteId: string) {
  const db = getDb();
  await db
    .delete(schema.officerIntelChunks)
    .where(
      and(
        eq(schema.officerIntelChunks.sourceType, "approved_note"),
        eq(schema.officerIntelChunks.sourceId, noteId),
      ),
    );
}

export async function dropOfficerActionItemChunks(actionItemId: string) {
  const db = getDb();
  await db
    .delete(schema.officerIntelChunks)
    .where(
      and(
        eq(schema.officerIntelChunks.sourceType, "action_item"),
        eq(schema.officerIntelChunks.sourceId, actionItemId),
      ),
    );
}

export async function indexOfficerMeetingNoteChunks(input: {
  allianceId: string;
  note: OfficerMeetingNoteSummary;
  session: {
    title: string;
    channelLabel: string | null;
    sessionAt: Date | null;
  };
  localeCode: string;
  approvedAt?: Date | null;
}) {
  const chunkTexts = buildApprovedNoteChunks({
    note: {
      summary: input.note.summary,
      keyDecisions: input.note.keyDecisions,
      openQuestions: input.note.openQuestions,
    },
    session: toSessionContext(input.session),
  });

  await deleteChunksForSource({
    allianceId: input.allianceId,
    sourceType: "approved_note",
    sourceId: input.note.id,
  });

  if (chunkTexts.length === 0) return;

  const embeddings = await embedTexts(chunkTexts);
  const db = getDb();
  const now = new Date();
  const approvedAt = input.approvedAt ?? null;

  await db.insert(schema.officerIntelChunks).values(
    chunkTexts.map((chunkText, index) => ({
      id: nanoid(),
      allianceId: input.allianceId,
      sourceType: "approved_note" as const,
      sourceId: input.note.id,
      sessionId: input.note.sessionId,
      localeCode: input.localeCode,
      chunkText,
      embedding: embeddings?.[index] ?? null,
      approvedAt,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

export async function indexOfficerActionItemChunk(input: {
  allianceId: string;
  item: OfficerActionItemRecord;
  session?: {
    title: string;
    channelLabel: string | null;
    sessionAt: Date | null;
  } | null;
  localeCode: string;
}) {
  if (input.item.status === "done" || input.item.status === "cancelled") {
    await dropOfficerActionItemChunks(input.item.id);
    return;
  }

  const chunkText = buildActionItemChunk({
    item: {
      title: input.item.title,
      description: input.item.description,
      assigneeMemberName: input.item.assigneeMemberName,
      assigneeNameRaw: input.item.assigneeNameRaw,
      dueAt: input.item.dueAt,
      dueHint: input.item.dueHint,
    },
    session: input.session ? toSessionContext(input.session) : null,
  });

  await deleteChunksForSource({
    allianceId: input.allianceId,
    sourceType: "action_item",
    sourceId: input.item.id,
  });

  const embeddings = await embedTexts([chunkText]);
  const db = getDb();
  const now = new Date();

  await db.insert(schema.officerIntelChunks).values({
    id: nanoid(),
    allianceId: input.allianceId,
    sourceType: "action_item",
    sourceId: input.item.id,
    sessionId: input.item.sessionId,
    localeCode: input.localeCode,
    chunkText,
    embedding: embeddings?.[0] ?? null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}
