import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema } from "@/lib/db";
import type { KnowledgeTransaction } from "./resources.server";
import { knowledgeJobMatches } from "./knowledge-index.server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/officer-intel/embed-corpus.server", () => ({
  knowledgeEmbeddingModel: () => "test-embed",
  knowledgeEmbeddingConfigured: () => true,
  embedKnowledgeTexts: vi.fn(),
}));

import { remapKnowledgeUser } from "./resources.server";

/** Documents the pre-fix breakage: ownership bump without job remap drops Ask lineage. */
function buggyOwnershipRemapBreaksLineage() {
  const resource = {
    id: "note:1",
    allianceId: "a1",
    ownerHqUserId: "canonical",
    ownershipState: "hq" as const,
    archivedAt: null,
    knowledgeAiAllowed: true,
    knowledgeApprovedVersion: 1,
    contentVersion: 1,
    accessVersion: 2, // bumped by old remap
    knowledgeApprovalVersion: 1,
    knowledgeConsentVersion: 1,
  };
  const job = {
    id: "job:1",
    allianceId: "a1",
    resourceId: "note:1",
    ownerHqUserId: "source", // never remapped
    contentVersion: 1,
    accessVersion: 1, // stale vs bumped resource
    approvalVersion: 1,
    consentVersion: 1,
    model: "test-embed",
    dimensions: 1536,
    formatVersion: 1,
    state: "completed" as const,
    cursor: 0,
    totalChunks: null,
    manifestHash: null,
    attempts: 0,
    errorCode: null,
    leaseToken: null,
    leaseExpiresAt: null,
    availableAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return knowledgeJobMatches(job, resource as never);
}

describe("account-merge knowledge remap lineage", () => {
  it("documents that ownership bump + stale job owner fails knowledgeJobMatches (red without fix)", () => {
    expect(buggyOwnershipRemapBreaksLineage()).toBe(false);
  });

  it("keeps lineage when owner remaps without version bumps and jobs follow the canonical user", () => {
    const resource = {
      id: "note:1",
      allianceId: "a1",
      ownerHqUserId: "canonical",
      ownershipState: "hq" as const,
      archivedAt: null,
      knowledgeAiAllowed: true,
      knowledgeApprovedVersion: 1,
      contentVersion: 1,
      accessVersion: 1,
      knowledgeApprovalVersion: 1,
      knowledgeConsentVersion: 1,
    };
    const job = {
      id: "job:1",
      allianceId: "a1",
      resourceId: "note:1",
      ownerHqUserId: "canonical",
      contentVersion: 1,
      accessVersion: 1,
      approvalVersion: 1,
      consentVersion: 1,
      model: "test-embed",
      dimensions: 1536,
      formatVersion: 1,
      state: "completed" as const,
      cursor: 0,
      totalChunks: null,
      manifestHash: null,
      attempts: 0,
      errorCode: null,
      leaseToken: null,
      leaseExpiresAt: null,
      availableAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(knowledgeJobMatches(job, resource as never)).toBe(true);
  });
});

describe("remapKnowledgeUser", () => {
  const execute = vi.fn();
  const update = vi.fn();
  const select = vi.fn();
  const insert = vi.fn();
  const del = vi.fn();
  const tx = { execute, update, select, insert, delete: del } as unknown as KnowledgeTransaction;

  beforeEach(() => {
    execute.mockReset().mockResolvedValue(undefined);
    update.mockReset();
    select.mockReset();
    insert.mockReset();
    del.mockReset();
  });

  function mockUpdateChain() {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(((_patch: Record<string, unknown>) => ({ where })));
    update.mockReturnValue({ set });
    return { set, where };
  }

  function setPatches(set: ReturnType<typeof mockUpdateChain>["set"]) {
    return set.mock.calls.map(([patch]) => patch);
  }

  it("remaps resource + AI/history/generation job owners without bumping access or content versions", async () => {
    const { set } = mockUpdateChain();
    const forUpdate = vi.fn().mockResolvedValue([]);
    select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ for: forUpdate })),
      })),
    });

    await remapKnowledgeUser(tx, "source", "canonical");

    const patches = setPatches(set);
    expect(patches.some((patch) =>
      patch.ownerHqUserId === "canonical" && !("accessVersion" in patch) && !("version" in patch))).toBe(true);

    const tables = update.mock.calls.map((call) => call[0]);
    expect(tables).toContain(schema.knowledgeResources);
    expect(tables).toContain(schema.knowledgeIndexJobs);
    expect(tables).toContain(schema.knowledgeProcessingJobs);
    expect(tables).toContain(schema.knowledgeGenerationJobs);
    expect(tables).toContain(schema.knowledgeAiUsage);

    expect(patches.some((patch) =>
      patch.ownerHqUserId === "canonical" && Object.keys(patch).length === 2 && "updatedAt" in patch)).toBe(true);
    expect(patches.some((patch) => patch.requesterId === "canonical")).toBe(true);
    expect(patches.some((patch) => patch.principalKey === "hq:canonical")).toBe(true);

    // Resource ownership / job remaps must not bump lineage versions.
    const lineageTables = new Set([
      schema.knowledgeResources,
      schema.knowledgeIndexJobs,
      schema.knowledgeProcessingJobs,
      schema.knowledgeGenerationJobs,
    ]);
    for (let i = 0; i < update.mock.calls.length; i++) {
      if (!lineageTables.has(update.mock.calls[i]![0])) continue;
      const patch = patches[i]!;
      expect(patch).not.toHaveProperty("accessVersion");
      expect(patch).not.toHaveProperty("version");
    }
  });

  it("remaps grant subjects without bumping accessVersion on shared notes", async () => {
    const { set } = mockUpdateChain();
    const grant = {
      id: "g1",
      resourceId: "note:shared",
      allianceId: "a1",
      subjectKind: "user" as const,
      subjectId: "source",
      role: "read" as const,
      createdByHqUserId: "owner",
      createdAt: new Date(),
    };
    const forUpdate = vi.fn().mockResolvedValue([grant]);
    select.mockReturnValue({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ for: forUpdate })),
      })),
    });
    insert.mockReturnValue({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      })),
    });
    del.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    await remapKnowledgeUser(tx, "source", "canonical");

    expect(del).toHaveBeenCalled();
    const patches = setPatches(set);
    // Never bump knowledge_resources.accessVersion during grant subject remap.
    for (let i = 0; i < update.mock.calls.length; i++) {
      if (update.mock.calls[i]![0] !== schema.knowledgeResources) continue;
      expect(patches[i]).not.toHaveProperty("accessVersion");
    }
  });
});
