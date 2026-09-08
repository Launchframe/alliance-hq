import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ access: vi.fn(), loadBoard: vi.fn(), loadHistory: vi.fn(), lockBoard: vi.fn(), persist: vi.fn(), recheck: vi.fn(), roster: vi.fn(), transaction: vi.fn(), select: vi.fn(), active: false }));
vi.mock("./access.server", () => ({ requireSupportAccess: mocks.access }));
vi.mock("./repository.server", () => ({ loadBoard: mocks.loadBoard, loadHistory: mocks.loadHistory, lockBoard: mocks.lockBoard, persistEvent: mocks.persist, recheckActor: mocks.recheck }));
vi.mock("./roster.server", () => ({ loadSupportRoster: mocks.roster }));
vi.mock("@/lib/db", async (original) => {
  const actual = await original<typeof import("@/lib/db")>();
  return { ...actual, getDb: () => ({ transaction: mocks.transaction }) };
});
import { executeSupportCommand, executeSupportUndo, supportSnapshot } from "./service.server";
import { emptyBoard } from "./policy.shared";
import type { SupportAccess } from "./access.server";
import type { SupportCommand } from "./types.shared";

const access: SupportAccess = { sessionId: "session", canViewPublished: true, actor: { allianceId: "a", principalId: "owner", override: true, canRead: true, canWrite: true, linkedMemberIds: [] } };
const command: SupportCommand = { kind: "createTeam", teamId: "team-a", leadId: "lead-a", expectedVersion: 0 };
function query(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "where", "for", "innerJoin"]) builder[method] = () => builder;
  builder.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
  return builder;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active = false;
  mocks.access.mockImplementation(async () => { expect(mocks.active).toBe(false); return access; });
  mocks.loadBoard.mockResolvedValue(emptyBoard("a"));
  mocks.loadHistory.mockResolvedValue([]);
  mocks.roster.mockResolvedValue([{ id: "lead-a", rank: 4, name: "Lead A" }]);
  mocks.select.mockImplementation(() => query([]));
  mocks.transaction.mockImplementation(async (callback) => { mocks.active = true; try { return await callback({ select: mocks.select }); } finally { mocks.active = false; } });
  mocks.recheck.mockImplementation(async () => { expect(mocks.active).toBe(true); });
});
describe("support team transaction orchestration", () => {
  it("refreshes DB-backed permission helpers before reserving the transaction and rechecks on its connection", async () => {
    const result = await executeSupportCommand(access, command, "create-intent");
    expect(mocks.access).toHaveBeenCalledWith("write");
    expect(mocks.recheck).toHaveBeenCalledWith(expect.anything(), access.actor, "session");
    expect(mocks.lockBoard).toHaveBeenCalledWith(expect.anything(), "a");
    expect(mocks.persist).toHaveBeenCalledOnce();
    expect(result.event).toMatchObject({ allianceId: "a", principalId: "owner", boardVersion: 1, memberNames: { "lead-a": "Lead A" } });
  });
  it("replays a matching actor-scoped intent without recomputing or appending an action", async () => {
    const event = { id: "original" };
    mocks.select.mockReturnValueOnce(query([{ requestHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"), event }]));
    expect(await executeSupportCommand(access, command, "create-intent")).toEqual({ event, replayed: true });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.roster).not.toHaveBeenCalled();
  });
  it("rejects intent reuse for another command and refreshed tenant changes", async () => {
    mocks.select.mockReturnValueOnce(query([{ requestHash: "different", event: {} }]));
    await expect(executeSupportCommand(access, command, "create-intent")).rejects.toThrow("changed");
    mocks.access.mockResolvedValue({ ...access, actor: { ...access.actor, allianceId: "other" } });
    await expect(executeSupportCommand(access, command, "other-intent")).rejects.toThrow("forbidden");
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("computes undo on the server rather than accepting client inverse state", async () => {
    await expect(executeSupportUndo(access, { rootActionId: "unknown", actionIds: ["unknown"], expectedVersions: {} }, "undo-intent")).rejects.toThrow("forbidden");
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("never exposes the unpublished roster or field document to ordinary readers", async () => {
    const result = await supportSnapshot({ ...access, actor: { ...access.actor, override: false, canRead: false, canWrite: false } });
    expect(result).toMatchObject({ teams: [], roster: [], published: false, canWrite: false });
    expect(result).not.toHaveProperty("board");
    expect(mocks.roster).not.toHaveBeenCalled();
  });
});
