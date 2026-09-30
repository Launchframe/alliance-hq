import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { KnowledgeActor } from "./policy.shared";

const state = vi.hoisted(() => ({ enabled: true, version: 1, rate: 0, writes: [] as Array<{ table: string; value: Record<string, unknown> }> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/officer-intel/llm-config.server", () => ({ isOfficerIntelLlmConfigured: () => true, officerIntelLlmModel: () => "test-model" }));
vi.mock("@/lib/performance-notes/repository.server", () => ({ listPerformanceNoteRoster: async () => [], getPerformanceNoteForAlliance: vi.fn() }));
vi.mock("@/lib/notes/resources.server", async (original) => ({ ...await original<typeof import("./resources.server")>(), recheckKnowledgeActor: vi.fn(async () => undefined) }));
vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const db = {
    execute: vi.fn(async () => []),
    select: (selection?: unknown) => {
      let name = "";
      const rows = () => name === "knowledge_intake_preferences" ? [{ enabled: state.enabled, version: state.version }] : selection ? [{ value: state.rate }] : [];
      const query = { from: (table: Parameters<typeof getTableName>[0]) => { name = getTableName(table); return query; }, where: () => query, for: async () => rows(), limit: async () => rows(), then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows()).then(resolve) };
      return query;
    },
    insert: (table: Parameters<typeof getTableName>[0]) => ({ values: async (value: Record<string, unknown>) => { state.writes.push({ table: getTableName(table), value }); } }),
    update: (table: Parameters<typeof getTableName>[0]) => ({ set: (value: Record<string, unknown>) => ({ where: () => {
      state.writes.push({ table: getTableName(table), value });
      return { returning: async () => [{ id: "analysis" }], then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve) };
    } }) }),
    transaction: async <T>(operation: (tx: unknown) => Promise<T>): Promise<T> => operation(db),
  };
  return { schema, getDb: () => db };
});

import { interpretNoteCapture } from "./intake.server";

const actor: KnowledgeActor = { kind: "web", allianceId: "alliance", hqUserId: "author", discordUserId: null, isOfficer: true, readableBoardIds: [], editableBoardIds: [] };
const input = { draftId: "draft-one", revision: 1, overrideRevision: 0, body: "Only a thought", locale: "en-US" as const };
const empty = { priority: null, priorityEvidence: null, actions: [] };
beforeEach(() => { state.enabled = true; state.version = 1; state.rate = 0; state.writes = []; });

describe("private intake provider boundary", () => {
  it("never calls a provider before author opt-in", async () => {
    state.enabled = false;
    const provider = vi.fn(async () => empty);
    await expect(interpretNoteCapture(actor, input, undefined, provider)).rejects.toMatchObject({ code: "intake_disabled" });
    expect(provider).not.toHaveBeenCalled();
  });
  it("sends redacted text and never persists a task or the raw draft", async () => {
    const provider = vi.fn<(body: string) => Promise<typeof empty>>().mockResolvedValue(empty);
    const result = await interpretNoteCapture(actor, { ...input, body: `Sensitive player ${"1".repeat(14)} password=example-private` }, undefined, provider);
    expect(/\d{12,20}/.test(provider.mock.calls[0][0])).toBe(false);
    expect(provider.mock.calls[0][0].includes("example-private")).toBe(false);
    expect(result.state).toBe("complete");
    expect(state.writes.every((write) => write.table === "knowledge_intake_analyses")).toBe(true);
    const completed = state.writes.find((write) => write.value.state === "complete");
    expect(completed?.value.result).not.toHaveProperty("body");
  });
  it("discards provider output when consent is revoked in flight", async () => {
    const provider = vi.fn(async () => { state.enabled = false; return empty; });
    await expect(interpretNoteCapture(actor, input, undefined, provider)).rejects.toMatchObject({ code: "intake_disabled" });
    expect(state.writes.some((write) => write.value.state === "complete")).toBe(false);
  });
  it("rejects ungrounded model evidence and enforces the per-principal budget", async () => {
    const provider = vi.fn(async () => ({ priority: "high" as const, priorityEvidence: "Not in this capture", actions: [] }));
    await expect(interpretNoteCapture(actor, input, undefined, provider)).rejects.toMatchObject({ code: "invalid_analysis" });
    state.rate = 12;
    provider.mockClear();
    await expect(interpretNoteCapture(actor, input, undefined, provider)).rejects.toMatchObject({ code: "rate_limited" });
    expect(provider).not.toHaveBeenCalled();
  });
});
