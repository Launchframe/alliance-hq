import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ access: vi.fn(), loadBoard: vi.fn(), loadHistory: vi.fn(), lockBoard: vi.fn(), persist: vi.fn(), recheck: vi.fn(), roster: vi.fn(), transaction: vi.fn(), select: vi.fn(), active: false }));
vi.mock("./access.server", () => ({ requireSupportAccess: mocks.access }));
vi.mock("./repository.server", () => ({ loadBoard: mocks.loadBoard, loadHistory: mocks.loadHistory, lockBoard: mocks.lockBoard, persistEvent: mocks.persist, recheckActor: mocks.recheck }));
vi.mock("./roster.server", () => ({ loadSupportRoster: mocks.roster }));
vi.mock("./draft-roster.server", () => ({ withDraftStintTokens: async (_db: unknown, _alliance: string, roster: unknown) => roster }));
vi.mock("./draft-notice.server", () => ({ persistDraftNotice: vi.fn() }));
vi.mock("@/lib/db", async (original) => {
  const actual = await original<typeof import("@/lib/db")>();
  return { ...actual, getDb: () => ({ transaction: mocks.transaction }) };
});
import { executeSupportCommand, executeSupportUndo, supportSnapshot } from "./service.server";
import { applyCommand, emptyBoard } from "./policy.shared";
import { applyDraftCommand, draftSnapshot, type DraftCommand } from "./draft.shared";
import { executeDraftCommand } from "./draft.server";
import type { SupportRosterMember } from "./types.shared";
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
  mocks.transaction.mockImplementation(async (callback) => { mocks.active = true; try { return await callback({ select: mocks.select, execute: async () => [{ now: new Date("2026-09-10T12:00:00Z") }] }); } finally { mocks.active = false; } });
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
    expect(await executeSupportCommand(access, command, "create-intent")).toEqual({ event, version: 0, replayed: true });
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
  it("does not disguise another actor's inverse as an ordinary own-team move", async () => {
    const roster = [{ id: "lead-a", rank: 4, name: "A" }, { id: "member", rank: 3, name: "Member" }] as SupportRosterMember[];
    const setup = applyCommand(emptyBoard("a"), roster, access.actor, command, { id: "setup", at: "2026-09-10T12:00:00Z", idempotencyKey: "setup" });
    const placed = applyCommand({ ...setup.board, published: true }, roster, access.actor, { kind: "move", memberId: "member", from: null, to: "team-a", expectedVersion: 1 }, { id: "placed", at: "2026-09-10T12:00:00Z", idempotencyKey: "placed" });
    const officerAccess = { ...access, actor: { ...access.actor, principalId: "officer", override: false, linkedMemberIds: ["lead-a"] } };
    mocks.access.mockResolvedValue(officerAccess);
    mocks.loadBoard.mockResolvedValue(placed.board);
    mocks.loadHistory.mockResolvedValue([setup.event, placed.event]);
    mocks.roster.mockResolvedValue(roster);
    mocks.select.mockReturnValueOnce(query([])).mockReturnValueOnce(query([])).mockReturnValueOnce(query([{ memberId: "lead-a" }]));
    await expect(executeSupportCommand(officerAccess, { kind: "move", memberId: "member", from: "team-a", to: null, expectedVersion: 2 }, "disguised")).rejects.toThrow("forbidden");
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("rechecks an expired session after obtaining the board lock and writes nothing", async () => {
    mocks.recheck.mockRejectedValueOnce(new Error("forbidden"));
    await expect(executeSupportCommand(access, command, "expired")).rejects.toThrow("forbidden");
    expect(mocks.lockBoard.mock.invocationCallOrder[0]).toBeLessThan(mocks.recheck.mock.invocationCallOrder[0]);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("persists the human pick and linked system transition in the same transaction with coherent versions", async () => {
    const roster = [{ id: "lead-a", rank: 4, name: "A" }, { id: "lead-b", rank: 5, name: "B" }, { id: "one", rank: 3, name: "One" }, { id: "two", rank: 3, name: "Two" }, { id: "three", rank: 3, name: "Three" }, { id: "four", rank: 3, name: "Four" }] as SupportRosterMember[];
    const scheduled = applyDraftCommand(emptyBoard("a"), roster, access.actor, { kind: "scheduleDraft", draftId: "d", expectedVersion: 0, startsAt: "2026-09-10T12:00:00Z", endsAt: "2026-09-10T14:00:00Z", roundMinutes: 5 }, { id: "schedule", at: "2026-09-10T11:00:00Z", idempotencyKey: "schedule" });
    const snapshot = draftSnapshot(scheduled.board, roster, access.actor, "d", Date.parse("2026-09-10T12:00:00Z"));
    const pick = (team: number, memberId: string): DraftCommand => ({ kind: "draftPick", draftId: "d", teamId: snapshot.teams[team].id, memberId, expectedRound: 1, expectedRoundVersion: snapshot.resourceVersions.round, expectedMemberVersion: snapshot.resourceVersions.members[memberId], expectedSlotVersion: 0 });
    const first = applyDraftCommand(scheduled.board, roster, access.actor, pick(0, "one"), { id: "first", at: "2026-09-10T12:00:00Z", idempotencyKey: "first" });
    mocks.loadBoard.mockResolvedValue(first.board);
    mocks.loadHistory.mockResolvedValue([scheduled.event, first.event]);
    mocks.roster.mockResolvedValue(roster);
    mocks.persist.mockImplementation(async () => { expect(mocks.active).toBe(true); });
    const result = await executeDraftCommand(access, pick(1, "two"), "second");
    expect(mocks.persist).toHaveBeenCalledTimes(2);
    expect(mocks.persist.mock.calls[0][2]).toMatchObject({ kind: "draftPick", principalType: "human", boardVersion: 3 });
    expect(mocks.persist.mock.calls[1][2]).toMatchObject({ kind: "advanceDraft", principalType: "service", principalId: "service:support-team-draft", boardVersion: 4, context: { sourceActionId: result.event.id } });
    expect(result.version).toBe(4);
    mocks.persist.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(executeDraftCommand(access, pick(1, "two"), "failure")).rejects.toThrow("database unavailable");
  });
  it("never exposes the unpublished roster or field document to ordinary readers", async () => {
    const result = await supportSnapshot({ ...access, actor: { ...access.actor, override: false, canRead: false, canWrite: false } });
    expect(result).toMatchObject({ teams: [], roster: [], published: false, canWrite: false });
    expect(result).not.toHaveProperty("board");
    expect(mocks.roster).not.toHaveBeenCalled();
  });
});
