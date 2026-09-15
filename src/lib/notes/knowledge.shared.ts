import { z } from "zod";
import { redactIntakeText } from "./intake.shared";

export const KNOWLEDGE_CHUNK_CHARS = 2_000;
export const KNOWLEDGE_BATCH_SIZE = 8;
export const KNOWLEDGE_MAX_CHARS = 1_000_000;
export const KNOWLEDGE_MAX_CHUNKS = 4_096;
export const KNOWLEDGE_DIMENSIONS = 1_536;
export const KNOWLEDGE_FORMAT_VERSION = 1;
export type KnowledgePiece = { locator: string; text: string; sourceDate: string | null };
export type KnowledgeReference = { locator: string; start: number; end: number; sourceDate: string | null };
export type KnowledgeChunk = { text: string; evidence: KnowledgeReference[] };
export type KnowledgeJobState = "pending" | "running" | "completed" | "cancelled" | "failed";
export const knowledgeCommandSchema = z.object({ requestId: z.string().min(8).max(120), expectedVersion: z.number().int().positive(), expectedContentVersion: z.number().int().positive(), command: z.enum(["approve", "unapprove", "allow_ai", "deny_ai", "index", "cancel", "retry"]) });
export type KnowledgeCommand = z.infer<typeof knowledgeCommandSchema>;
export const knowledgeQuerySchema = z.object({ q: z.string().trim().min(1).max(2_000), mode: z.enum(["keyword", "semantic"]).default("keyword"), includeSources: z.boolean().default(false), limit: z.number().int().min(1).max(6).default(6) });
export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;
export type KnowledgeStatus = {
  resourceId: string; kind: "note" | "task" | "source"; entityId: string; title: string; href: string | null;
  version: number; contentVersion: number; approved: boolean; aiAllowed: boolean; isOwner: boolean; canEnable: boolean; configured: boolean;
  indexState: KnowledgeJobState | "none" | "outdated"; completedChunks: number; totalChunks: number | null; errorCode: string | null;
};
export type KnowledgeEvidence = { id: string; resourceId: string; kind: "note" | "task" | "source"; entityId: string; text: string; evidence: KnowledgeReference[]; contentHash: string; contentVersion: number; accessVersion: number; approvalVersion: number; consentVersion: number; model: string; jobId: string };
export function knowledgeChunkFingerprint(chunk: KnowledgeChunk) {
  return [chunk.text, chunk.evidence.map((item) => [item.locator, item.start, item.end, item.sourceDate])];
}
export function validKnowledgeEmbedding(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== KNOWLEDGE_DIMENSIONS || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return false;
  const norm = value.reduce((total, item) => total + item * item, 0);
  return norm > 1e-20 && norm < 1e20;
}
export function buildKnowledgeChunks(pieces: KnowledgePiece[]): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  let current: KnowledgeChunk = { text: "", evidence: [] };
  let size = 0;
  const flush = () => { if (current.text) chunks.push(current); current = { text: "", evidence: [] }; };
  for (const piece of pieces) {
    const text = redactIntakeText(piece.text);
    size += text.length;
    if (size > KNOWLEDGE_MAX_CHARS) throw new Error("too_large");
    if (!text.trim()) continue;
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + KNOWLEDGE_CHUNK_CHARS, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const part = text.slice(start, end);
      if (current.text && current.text.length + 1 + part.length > KNOWLEDGE_CHUNK_CHARS || current.evidence.length >= 32) flush();
      current.text += (current.text ? "\n" : "") + part;
      current.evidence.push({ locator: piece.locator, start, end, sourceDate: piece.sourceDate });
      start = end;
      if (chunks.length >= KNOWLEDGE_MAX_CHUNKS) throw new Error("too_large");
    }
  }
  flush();
  if (chunks.length > KNOWLEDGE_MAX_CHUNKS) throw new Error("too_large");
  return chunks;
}
