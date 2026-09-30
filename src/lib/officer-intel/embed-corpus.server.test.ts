import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { embedKnowledgeTexts, knowledgeEmbeddingConfigured, knowledgeEmbeddingModel, knowledgeTestProviderEnabled } from "./embed-corpus.server";

afterEach(() => vi.unstubAllEnvs());
it("requires every test-provider fence and never selects it on Vercel", () => {
  vi.stubEnv("E2E_TEST", "true"); vi.stubEnv("NOTES_KNOWLEDGE_TEST_PROVIDER", "1"); vi.stubEnv("VERCEL", "");
  expect(knowledgeTestProviderEnabled()).toBe(true);
  expect(knowledgeEmbeddingModel()).toBe("e2e-knowledge-1536");
  vi.stubEnv("VERCEL", "1");
  expect(knowledgeTestProviderEnabled()).toBe(false);
  vi.stubEnv("VERCEL", ""); vi.stubEnv("E2E_TEST", "false");
  expect(knowledgeTestProviderEnabled()).toBe(false);
});
it("does not contact a provider when configuration is unavailable", async () => {
  vi.stubEnv("E2E_TEST", "false"); vi.stubEnv("OPENAI_API_KEY", "");
  expect(knowledgeEmbeddingConfigured()).toBe(false);
  await expect(embedKnowledgeTexts(["Private input"])).rejects.toMatchObject({ code: "not_configured" });
});
