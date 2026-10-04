import { expect, it, vi } from "vitest";
import type { KnowledgeActor } from "./policy.shared";
import type { KnowledgeTransaction } from "./resources.server";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn(() => { throw new Error("Unexpected pool acquisition"); }) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async (original) => ({ ...await original<typeof import("@/lib/db")>(), getDb }));
vi.mock("@/lib/performance-notes/repository.server", () => ({ getPerformanceNoteForAlliance: vi.fn() }));
vi.mock("@/lib/notes/resources.server", () => ({ knowledgeAccessCondition: vi.fn(), KnowledgeAccessError: Error, lockKnowledgeResource: vi.fn(), touchKnowledgeResource: vi.fn() }));
vi.mock("@/lib/notes/board-events.server", () => ({ touchResourceBoards: vi.fn() }));
import { listKnowledgePeople } from "./sharing.server";

it("uses the supplied transaction instead of acquiring another pool connection", async () => {
  const chain = { from: vi.fn(), innerJoin: vi.fn(), leftJoin: vi.fn(), where: vi.fn() };
  chain.from.mockReturnValue(chain); chain.innerJoin.mockReturnValue(chain); chain.leftJoin.mockReturnValue(chain);
  chain.where.mockResolvedValue([{ id: "owner", name: "Owner", role: "officer", commanderName: "Cookie" }, { id: "peer", name: "Peer", role: "viewer", commanderName: null }]);
  const transaction = { select: vi.fn(() => chain) } as unknown as Pick<KnowledgeTransaction, "select">;
  const actor = { allianceId: "alliance", hqUserId: "owner" } as KnowledgeActor;
  await expect(listKnowledgePeople(actor, true, transaction)).resolves.toEqual([{ id: "owner", name: "Cookie", role: "officer" }, { id: "peer", name: "Peer", role: "viewer" }]);
  await expect(listKnowledgePeople(actor, false, transaction)).resolves.toEqual([{ id: "peer", name: "Peer", role: "viewer" }]);
  expect(getDb).not.toHaveBeenCalled();
});
