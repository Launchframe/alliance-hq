import { describe, expect, it } from "vitest";
import { buildKnowledgeChunks, knowledgeChunkFingerprint, validKnowledgeEmbedding, KNOWLEDGE_CHUNK_CHARS, type KnowledgePiece } from "./knowledge.shared";

describe("knowledge evidence chunks", () => {
  it("covers long text without silently dropping the tail or breaking Unicode", () => {
    const text = "a".repeat(KNOWLEDGE_CHUNK_CHARS - 1) + String.fromCodePoint(0x1d400) + "end".repeat(2_000);
    const chunks = buildKnowledgeChunks([{ locator: "body", text, sourceDate: null }]);
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.text.length <= KNOWLEDGE_CHUNK_CHARS)).toBe(true);
    expect(chunks.at(-1)?.evidence.at(-1)?.end).toBe(text.length);
  });
  it("keeps source locators/dates and redacts identifiers before embedding", () => {
    const pieces: KnowledgePiece[] = [{ locator: "message-one", sourceDate: "2026-09-01T12:00:00Z", text: `Player ${"1".repeat(14)} token=synthetic-secret` }, { locator: "message-two", sourceDate: null, text: "A different source message" }];
    const chunks = buildKnowledgeChunks(pieces);
    expect(JSON.stringify(chunks)).not.toContain("synthetic-secret");
    expect(JSON.stringify(chunks)).not.toContain("1".repeat(14));
    expect(chunks.flatMap((chunk) => chunk.evidence).map((item) => item.locator)).toEqual(["message-one", "message-two"]);
  });
  it("fingerprints evidence independently of JSONB property ordering", () => {
    const first = { text: "Evidence", evidence: [{ locator: "body", start: 0, end: 8, sourceDate: null }] };
    const reordered = { text: "Evidence", evidence: [{ end: 8, sourceDate: null, start: 0, locator: "body" }] };
    expect(JSON.stringify(knowledgeChunkFingerprint(first))).toBe(JSON.stringify(knowledgeChunkFingerprint(reordered)));
  });
  it("rejects incompatible or unusable embedding vectors", () => {
    expect(validKnowledgeEmbedding([1])).toBe(false);
    expect(validKnowledgeEmbedding(Array(1536).fill(0))).toBe(false);
    expect(validKnowledgeEmbedding([Infinity, ...Array(1535).fill(0)])).toBe(false);
    expect(validKnowledgeEmbedding(Array(1536).fill(1e-300))).toBe(false);
    expect(validKnowledgeEmbedding(Array(1536).fill(1e300))).toBe(false);
    expect(validKnowledgeEmbedding([1, ...Array(1535).fill(0)])).toBe(true);
  });
});
