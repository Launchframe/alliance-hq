import { beforeEach, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ row: {} as Record<string, unknown>, update: vi.fn(), set: vi.fn(), generate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateObject: testState.generate }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => (model: string) => model }));
vi.mock("@/lib/officer-intel/embed-corpus.server", () => ({ knowledgeTestProviderEnabled: () => false }));
vi.mock("@/lib/officer-intel/llm-config.server", () => ({ isOfficerIntelLlmConfigured: () => true, officerIntelLlmModel: () => "test-model" }));
vi.mock("./access.server", () => ({ getKnowledgeActorForGenerationJob: vi.fn() }));
vi.mock("@/lib/db", async (original) => ({
  ...await original<typeof import("@/lib/db")>(),
  getDb: () => ({ transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
    select: () => ({ from: () => ({ where: () => ({ for: async () => [testState.row] }) }) }),
    update: testState.update,
  }) }),
}));
import { stopGeneration, cancelGenerationCandidate } from "./generation.server";
import { generateKnowledgePart } from "@/lib/officer-intel/synthesize.server";
import { generationPartSchema, type GenerationPart } from "./generation.shared";

const generationInput = { kind: "synthesize" as const, locale: "pt-BR", question: "", context: [], sources: [{ id: "source-one", text: "The task was cancelled." }] };
const generatedPart: GenerationPart = {
  title: "Revisão", sections: [{ text: "A tarefa foi cancelada.", citations: [{ id: "source-one", quote: "The task was cancelled." }] }],
  actions: [{ title: "Tarefa cancelada", description: null, status: "cancelled", priority: null, evidence: "The task was cancelled.", evidenceId: "source-one" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  testState.row = { id: "job", version: 3, attempts: 1, state: "running", availableAt: new Date(Date.now() - 1), threadId: null, leaseToken: "lease", leaseExpiresAt: new Date(Date.now() + 60_000) };
  testState.update.mockReturnValue({ set: testState.set });
  testState.set.mockReturnValue({ where: async () => undefined });
  testState.generate.mockResolvedValue({ object: generatedPart });
});
it("does not let an expired worker change job state on failure", async () => {
  testState.row.leaseExpiresAt = new Date(Date.now() - 1);
  await stopGeneration("job", "lease", new Error("provider failure"));
  expect(testState.update).not.toHaveBeenCalled();
});
it("does not let a replaced worker token change job state on failure", async () => {
  testState.row.leaseToken = "replacement-lease";
  await stopGeneration("job", "stale-lease", new Error("provider failure"));
  expect(testState.update).not.toHaveBeenCalled();
});
it("does not cancel a newer generation version or release its conversation slot", async () => {
  testState.row.version = 4;
  testState.row.threadId = "thread";
  await cancelGenerationCandidate({ id: "job", version: 3, threadId: "thread" });
  expect(testState.update).not.toHaveBeenCalled();
});
it("does not cancel a live lease based on an old queue scan", async () => {
  await cancelGenerationCandidate({ id: "job", version: 3, threadId: null });
  expect(testState.update).not.toHaveBeenCalled();
});
it("cancels the unchanged expired candidate", async () => {
  testState.row.leaseExpiresAt = new Date(Date.now() - 1);
  await cancelGenerationCandidate({ id: "job", version: 3, threadId: null });
  expect(testState.set).toHaveBeenCalledWith(expect.objectContaining({ state: "cancelled", leaseToken: null }));
});
it("still retries a failure while the lease is valid", async () => {
  await stopGeneration("job", "lease", new Error("provider failure"));
  expect(testState.set).toHaveBeenCalledWith(expect.objectContaining({ state: "pending", version: 4, leaseToken: null }));
});
it("instructs generation to preserve reported task status rather than treat cancellation as completion", async () => {
  await expect(generateKnowledgePart(generationInput)).resolves.toEqual(generatedPart);
  const request = testState.generate.mock.calls[0][0];
  expect(request.system).toContain("completed work is done");
  expect(request.system).toContain("cancelled or abandoned work is cancelled, never done");
  expect(request.system).toContain("Respect negation and mixed clauses");
  expect(request.system).toContain("do not infer dependencies, commitments, or future intent");
  expect(request).toMatchObject({ model: "test-model", maxRetries: 0, schema: generationPartSchema });
  expect(JSON.parse(request.prompt)).toEqual(generationInput);
});
it("requests localized titles and all generated prose while retaining original evidence quotes", async () => {
  const localized = { ...generatedPart, actions: [] };
  testState.generate.mockResolvedValue({ object: localized });
  await expect(generateKnowledgePart({ ...generationInput, kind: "localize" })).resolves.toEqual(localized);
  const request = testState.generate.mock.calls[0][0];
  expect(request.system).toContain("title, section text, action titles, and action descriptions");
  expect(request.system).toContain("must use the requested locale");
  expect(request.system).toContain("Do not translate evidence IDs or exact quotes");
  expect(JSON.parse(request.prompt).locale).toBe("pt-BR");
});
it.each([
  { ...generatedPart, sections: [{ text: "Observação", citations: [{ id: "unknown", quote: "The task was cancelled." }] }] },
  { ...generatedPart, sections: [{ text: "Observação", citations: [{ id: "source-one", quote: "The task was abandoned." }] }] },
  { ...generatedPart, actions: [{ ...generatedPart.actions[0], evidence: "The task was completed." }] },
])("rejects unknown or paraphrased section/action evidence before returning a review", async (output) => {
  testState.generate.mockResolvedValue({ object: output });
  await expect(generateKnowledgePart(generationInput)).rejects.toMatchObject({ code: "invalid_analysis" });
  expect(testState.generate).toHaveBeenCalledTimes(1);
});
it("rejects incomplete localization and provider failures without another request", async () => {
  testState.generate.mockResolvedValue({ object: { ...generatedPart, actions: [] } });
  await expect(generateKnowledgePart({ ...generationInput, kind: "localize", sources: [...generationInput.sources, { id: "source-two", text: "A second source." }] })).rejects.toMatchObject({ code: "invalid_analysis" });
  testState.generate.mockClear().mockRejectedValue(new Error("synthetic provider failure"));
  await expect(generateKnowledgePart(generationInput)).rejects.toThrow("synthetic provider failure");
  expect(testState.generate).toHaveBeenCalledTimes(1);
});
