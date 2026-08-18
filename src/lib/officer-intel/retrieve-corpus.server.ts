import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { embed } from "ai";
import { and, asc, count, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { OFFICER_INTEL_CHARS_PER_TOKEN } from "@/lib/officer-intel/build-corpus-chunks.shared";
import {
  isOfficerIntelLlmConfigured,
  officerIntelEmbedModel,
} from "@/lib/officer-intel/llm-config.server";
import { officerIntelScoreWithRecency } from "@/lib/officer-intel/recency-boost.shared";
import { listOfficerChatMessages } from "@/lib/officer-intel/repository.server";
import { listOpenOfficerActionItems } from "@/lib/officer-intel/repository.server";
import type { OfficerActionItemRecord } from "@/lib/officer-intel/synthesis-types.shared";

export type OfficerIntelRetrievedChunk = {
  id: string;
  sourceType: "approved_note" | "action_item";
  sourceId: string;
  sessionId: string | null;
  text: string;
  sessionTitle: string | null;
  channelLabel: string | null;
  sessionAt: string | null;
  similarity: number;
};

const DEFAULT_RETRIEVE_K = 6;
const MAX_RETURN_CHARS = 3000 * OFFICER_INTEL_CHARS_PER_TOKEN;

type RawRetrievedRow = {
  id: string;
  source_type: string;
  source_id: string;
  session_id: string | null;
  chunk_text: string;
  approved_at: Date | null;
  session_title: string | null;
  channel_label: string | null;
  session_at: Date | null;
  similarity: number;
};

function formatEmbeddingForQuery(values: number[]): string {
  return `[${values.join(",")}]`;
}

function mapRow(row: RawRetrievedRow, similarity: number): OfficerIntelRetrievedChunk {
  return {
    id: row.id,
    sourceType: row.source_type as "approved_note" | "action_item",
    sourceId: row.source_id,
    sessionId: row.session_id,
    text: row.chunk_text,
    sessionTitle: row.session_title,
    channelLabel: row.channel_label,
    sessionAt: row.session_at?.toISOString() ?? null,
    similarity,
  };
}

function capRetrievedChunks(
  rows: OfficerIntelRetrievedChunk[],
): OfficerIntelRetrievedChunk[] {
  const capped: OfficerIntelRetrievedChunk[] = [];
  let totalChars = 0;
  for (const row of rows) {
    if (totalChars + row.text.length > MAX_RETURN_CHARS && capped.length > 0) {
      break;
    }
    capped.push(row);
    totalChars += row.text.length;
  }
  return capped;
}

async function retrieveByVector(input: {
  allianceId: string;
  queryEmbedding: number[];
  k: number;
}): Promise<OfficerIntelRetrievedChunk[]> {
  const db = getDb();
  const vectorExpr = sql.raw(
    `'${formatEmbeddingForQuery(input.queryEmbedding)}'::vector`,
  );
  const result = await db.execute(sql`
    SELECT
      c.id,
      c.source_type,
      c.source_id,
      c.session_id,
      c.chunk_text,
      c.approved_at,
      s.title AS session_title,
      s.channel_label,
      s.session_at,
      1 - (c.embedding <=> ${vectorExpr}) AS similarity
    FROM officer_intel_chunks c
    LEFT JOIN officer_chat_sessions s
      ON s.id = c.session_id AND s.alliance_id = c.alliance_id
    WHERE c.alliance_id = ${input.allianceId}
      AND c.embedding IS NOT NULL
    ORDER BY similarity DESC
    LIMIT ${input.k * 4}
  `);

  const rows = result as unknown as RawRetrievedRow[];

  const scored = (Array.isArray(rows) ? rows : []).map((row) =>
    mapRow(
      row,
      officerIntelScoreWithRecency(Number(row.similarity), row.approved_at),
    ),
  );

  scored.sort((a, b) => b.similarity - a.similarity);
  return capRetrievedChunks(scored.slice(0, input.k));
}

async function retrieveByKeyword(input: {
  allianceId: string;
  query: string;
  k: number;
}): Promise<OfficerIntelRetrievedChunk[]> {
  const db = getDb();
  const pattern = `%${input.query.trim()}%`;
  const rows = await db
    .select({
      id: schema.officerIntelChunks.id,
      sourceType: schema.officerIntelChunks.sourceType,
      sourceId: schema.officerIntelChunks.sourceId,
      sessionId: schema.officerIntelChunks.sessionId,
      chunkText: schema.officerIntelChunks.chunkText,
      sessionTitle: schema.officerChatSessions.title,
      channelLabel: schema.officerChatSessions.channelLabel,
      sessionAt: schema.officerChatSessions.sessionAt,
    })
    .from(schema.officerIntelChunks)
    .leftJoin(
      schema.officerChatSessions,
      and(
        eq(schema.officerChatSessions.id, schema.officerIntelChunks.sessionId),
        eq(
          schema.officerChatSessions.allianceId,
          schema.officerIntelChunks.allianceId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.officerIntelChunks.allianceId, input.allianceId),
        ilike(schema.officerIntelChunks.chunkText, pattern),
      ),
    )
    .orderBy(desc(schema.officerIntelChunks.updatedAt))
    .limit(input.k);

  return capRetrievedChunks(
    rows.map((row) => ({
      id: row.id,
      sourceType: row.sourceType as "approved_note" | "action_item",
      sourceId: row.sourceId,
      sessionId: row.sessionId,
      text: row.chunkText,
      sessionTitle: row.sessionTitle,
      channelLabel: row.channelLabel,
      sessionAt: row.sessionAt?.toISOString() ?? null,
      similarity: 0,
    })),
  );
}

async function hasAnyEmbeddings(allianceId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(schema.officerIntelChunks)
    .where(
      and(
        eq(schema.officerIntelChunks.allianceId, allianceId),
        isNotNull(schema.officerIntelChunks.embedding),
      ),
    );
  return Number(row?.value ?? 0) > 0;
}

export async function retrieveOfficerIntelCorpus(input: {
  allianceId: string;
  query: string;
  k?: number;
}): Promise<OfficerIntelRetrievedChunk[]> {
  const k = input.k ?? DEFAULT_RETRIEVE_K;
  const query = input.query.trim();
  if (!query) return [];

  const embedded = await hasAnyEmbeddings(input.allianceId);
  if (!embedded) {
    return retrieveByKeyword({ allianceId: input.allianceId, query, k });
  }

  if (!isOfficerIntelLlmConfigured()) {
    return retrieveByKeyword({ allianceId: input.allianceId, query, k });
  }

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { embedding } = await embed({
    model: openai.embedding(officerIntelEmbedModel()),
    value: query,
  });

  const vectorResults = await retrieveByVector({
    allianceId: input.allianceId,
    queryEmbedding: embedding,
    k,
  });
  if (vectorResults.length > 0) {
    return vectorResults;
  }

  return retrieveByKeyword({ allianceId: input.allianceId, query, k });
}

export async function listOpenActionItemsForAsk(
  allianceId: string,
): Promise<OfficerActionItemRecord[]> {
  return listOpenOfficerActionItems(allianceId);
}

export async function countApprovedOfficerMeetingNotes(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(schema.officerMeetingNotes)
    .where(
      and(
        eq(schema.officerMeetingNotes.allianceId, allianceId),
        eq(schema.officerMeetingNotes.status, "approved"),
      ),
    );
  return Number(row?.value ?? 0);
}

export async function loadSessionMessagesForAsk(input: {
  allianceId: string;
  sessionId: string;
  limit?: number;
}): Promise<
  Array<{ senderName: string; localeText: string; sequenceOrder: number }>
> {
  const limit = Math.min(Math.max(input.limit ?? 40, 1), 80);
  const db = getDb();
  const [session] = await db
    .select({ id: schema.officerChatSessions.id })
    .from(schema.officerChatSessions)
    .where(
      and(
        eq(schema.officerChatSessions.id, input.sessionId),
        eq(schema.officerChatSessions.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  if (!session) return [];

  const messages = await listOfficerChatMessages({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
  });

  return messages.slice(-limit).map((message) => ({
    senderName: message.senderName,
    localeText: message.localeText,
    sequenceOrder: message.sequenceOrder,
  }));
}
