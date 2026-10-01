import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeActor } from "./policy.shared";
import type { KnowledgeTransaction } from "./resources.server";
import { schema } from "@/lib/db";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn(() => { throw new Error("Unexpected pool acquisition"); }) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb }));

import { grantOfficersReadAccess, KnowledgeAccessError } from "./resources.server";

const actor = { allianceId: "alliance", hqUserId: "owner", kind: "web", discordUserId: null, isOfficer: true, readableBoardIds: [], editableBoardIds: [] } as KnowledgeActor;

describe("grantOfficersReadAccess", () => {
  const insert = vi.fn();
  const update = vi.fn();
  const select = vi.fn();
  const tx = { insert, update, select } as unknown as KnowledgeTransaction;

  beforeEach(() => {
    insert.mockReset();
    update.mockReset();
    select.mockReset();
  });

  it("fails closed when the note resource is missing", async () => {
    const where = vi.fn().mockResolvedValue([]);
    const from = vi.fn(() => ({ where }));
    select.mockReturnValue({ from });
    await expect(grantOfficersReadAccess(tx, actor, "note:missing")).rejects.toBeInstanceOf(KnowledgeAccessError);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("inserts an officers read grant on the subject unique key and bumps accessVersion", async () => {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoNothing }));
    insert.mockReturnValue({ values });
    const where = vi.fn();
    where.mockResolvedValueOnce([{ id: "note:one" }]);
    where.mockResolvedValueOnce(undefined);
    select.mockReturnValue({ from: vi.fn(() => ({ where })) });
    update.mockReturnValue({ set: vi.fn(() => ({ where })) });

    await grantOfficersReadAccess(tx, actor, "note:one");

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      resourceId: "note:one",
      allianceId: "alliance",
      subjectKind: "officers",
      subjectId: "alliance",
      role: "read",
      createdByHqUserId: "owner",
    }));
    expect(onConflictDoNothing).toHaveBeenCalledWith({
      target: [schema.knowledgeResourceGrants.resourceId, schema.knowledgeResourceGrants.subjectKind, schema.knowledgeResourceGrants.subjectId],
    });
    expect(update).toHaveBeenCalled();
  });
});
