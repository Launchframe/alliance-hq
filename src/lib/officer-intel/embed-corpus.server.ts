import "server-only";

import { createHash } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { KNOWLEDGE_BATCH_SIZE, KNOWLEDGE_CHUNK_CHARS, KNOWLEDGE_DIMENSIONS, validKnowledgeEmbedding } from "@/lib/notes/knowledge.shared";
import { redactIntakeText } from "@/lib/notes/intake.shared";
import { isOfficerIntelLlmConfigured, officerIntelEmbedModel } from "./llm-config.server";
import type { OfficerActionItemRecord, OfficerMeetingNoteSummary } from "./synthesis-types.shared";

type SessionContext = { title: string; channelLabel: string | null; sessionAt: Date | null };
export function knowledgeTestProviderEnabled() {
  return process.env.E2E_TEST === "true" && process.env.NOTES_KNOWLEDGE_TEST_PROVIDER === "1" && !process.env.VERCEL;
}
export function knowledgeEmbeddingModel() { return knowledgeTestProviderEnabled() ? "e2e-knowledge-1536" : officerIntelEmbedModel(); }
export function knowledgeEmbeddingConfigured() { return knowledgeTestProviderEnabled() || isOfficerIntelLlmConfigured(); }
export async function embedKnowledgeTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length || texts.length > KNOWLEDGE_BATCH_SIZE || texts.some((text) => !text || text.length > KNOWLEDGE_CHUNK_CHARS)) throw new KnowledgeAccessError("invalid");
  const values = texts.map(redactIntakeText);
  if (knowledgeTestProviderEnabled()) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return values.map((text) => {
      const vector = Array<number>(KNOWLEDGE_DIMENSIONS).fill(0);
      for (const word of text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [text]) vector[createHash("sha256").update(word).digest().readUInt16BE(0) % KNOWLEDGE_DIMENSIONS]++;
      if (!vector.some(Boolean)) vector[0] = 1;
      return vector;
    });
  }
  if (!knowledgeEmbeddingConfigured()) throw new KnowledgeAccessError("not_configured");
  const model = officerIntelEmbedModel();
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const { embeddings } = await embedMany({ model: openai.embedding(model), values, maxRetries: 0, maxParallelCalls: 1, abortSignal: AbortSignal.timeout(20_000), providerOptions: model.startsWith("text-embedding-3-") ? { openai: { dimensions: KNOWLEDGE_DIMENSIONS } } : undefined });
  if (embeddings.length !== values.length || !embeddings.every(validKnowledgeEmbedding)) throw new Error("invalid_embedding");
  return embeddings;
}
async function deleteLegacyChunks(allianceId: string, sourceType: string, sourceId: string) {
  await getDb().delete(schema.officerIntelChunks).where(and(eq(schema.officerIntelChunks.allianceId, allianceId), eq(schema.officerIntelChunks.sourceType, sourceType), eq(schema.officerIntelChunks.sourceId, sourceId), isNull(schema.officerIntelChunks.indexJobId)));
}
export async function dropOfficerMeetingNoteChunks(input: { allianceId: string; noteId: string }) { await deleteLegacyChunks(input.allianceId, "approved_note", input.noteId); }
export async function dropOfficerActionItemChunks(input: { allianceId: string; actionItemId: string }) { await deleteLegacyChunks(input.allianceId, "action_item", input.actionItemId); }
export async function indexOfficerMeetingNoteChunks(input: { allianceId: string; note: OfficerMeetingNoteSummary; session: SessionContext; localeCode: string; approvedAt?: Date | null }) {
  void input; throw new KnowledgeAccessError("not_configured");
}
export async function indexOfficerActionItemChunk(input: { allianceId: string; item: OfficerActionItemRecord; session?: SessionContext | null; localeCode: string }) {
  void input; throw new KnowledgeAccessError("not_configured");
}
