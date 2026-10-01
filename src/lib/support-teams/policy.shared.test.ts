import { describe, expect, it } from "vitest";
import { applyCommand, balancedTargets, decideCommand, emptyBoard, fieldKey, memberTeam, readField } from "./policy.shared";
import { confirmUndo, previewUndo } from "./history.shared";
import type { SupportActor, SupportBoard, SupportCommand, SupportEvent, SupportRosterMember } from "./types.shared";

const member = (id: string, rank = 3): SupportRosterMember => ({ id, name: id, previousNames: [], rank, country: null, professionLevel: null, baseLevel: null, basePower: null, kills: null, thp: null, tenureDays: null, hqLinked: false, discordLinked: false });
const roster = [member("lead-a", 4), member("lead-b", 5), member("next-lead", 4), ...Array.from({ length: 30 }, (_, i) => member(`member-${i}`))];
const owner: SupportActor = { allianceId: "a", principalId: "owner", canRead: true, canWrite: true, override: true, linkedMemberIds: [] };
const officer: SupportActor = { ...owner, principalId: "officer", override: false, linkedMemberIds: ["lead-a", "next-lead"] };
function setup() {
  let board = emptyBoard("a");
  const events: SupportEvent[] = [];
  const run = (command: SupportCommand, actor = owner) => {
    const result = applyCommand(board, roster, actor, command, { id: `action-${events.length}`, at: "2026-09-09T00:00:00.000Z", idempotencyKey: `intent-${events.length}` });
    board = result.board;
    events.push(result.event);
    return result.event;
  };
  run({ kind: "createTeam", teamId: "a-team", name: "Alpha", leadId: "lead-a", expectedVersion: 0 });
  run({ kind: "createTeam", teamId: "b-team", name: "Beta", leadId: "lead-b", expectedVersion: 1 });
  board = { ...board, published: true };
  return { get board() { return board; }, set board(value: SupportBoard) { board = value; }, events, run };
}
const move = (version: number, memberId: string, from: string | null, to: string | null): SupportCommand => ({ kind: "move", memberId, from, to, expectedVersion: version });

describe("support team shared command boundary", () => {
  it("balances all roster seats rather than imposing ten and counts leads once", () => {
    expect(balancedTargets(33, ["a-team", "b-team"])).toEqual({ "a-team": 17, "b-team": 16 });
    const s = setup();
    expect(readField(s.board, fieldKey("member", "lead-a", "team"))).toBe("a-team");
  });
  it.each(["drag", "search", "button", "mobile"])("uses the same policy for %s and rejects stealing another lead's members", () => {
    const s = setup();
    s.run(move(s.board.version, "member-0", null, "b-team"));
    const command = move(s.board.version, "member-0", "b-team", "a-team");
    expect(decideCommand(s.board, roster, officer, command)).toBe("forbidden");
    expect(() => s.run(command, officer)).toThrow("forbidden");
  });
  it("denies cross-tenant, anonymous and revoked writers, including a linked lead", () => {
    const s = setup();
    for (const actor of [{ ...officer, allianceId: "other" }, { ...officer, principalId: "" }, { ...officer, canWrite: false }]) {
      expect(decideCommand(s.board, roster, actor, move(s.board.version, "member-0", null, "a-team"))).toBe("forbidden");
    }
  });
  it("cannot construct or mutate a future draft/proposal through generic maintenance", () => {
    const s = setup();
    for (const board of [{ ...s.board, construction: { kind: "draft" as const, id: "d" } }, { ...s.board, construction: { kind: "proposal" as const, id: "p" } }]) {
      expect(decideCommand(board, roster, owner, move(board.version, "member-0", null, "a-team"))).toBe("changed");
    }
  });
  it("preserves persistent names on lead replacement and allows the incoming lead to rename", () => {
    const s = setup();
    s.run({ kind: "rename", teamId: "a-team", name: "Alpha", expectedVersion: s.board.version }, officer);
    s.run({ kind: "replaceLead", teamId: "a-team", leadId: "next-lead", expectedVersion: s.board.version });
    expect(readField(s.board, fieldKey("team", "a-team", "name"))).toBe("Alpha");
    s.run({ kind: "rename", teamId: "a-team", name: "Beta", expectedVersion: s.board.version }, officer);
    expect(decideCommand(s.board, roster, { ...officer, linkedMemberIds: ["lead-b"] }, { kind: "rename", teamId: "a-team", name: "Other", expectedVersion: s.board.version })).toBe("forbidden");
  });
  it("moves and swaps atomically without duplicating assignments or moving a lead seat", () => {
    const s = setup();
    s.run(move(s.board.version, "member-0", null, "a-team"));
    s.run(move(s.board.version, "member-1", null, "b-team"));
    s.run({ kind: "swap", memberId: "member-0", otherMemberId: "member-1", from: "a-team", to: "b-team", expectedVersion: s.board.version });
    expect(readField(s.board, fieldKey("member", "member-0", "team"))).toBe("b-team");
    expect(readField(s.board, fieldKey("member", "member-1", "team"))).toBe("a-team");
    expect(decideCommand(s.board, roster, owner, move(s.board.version, "lead-a", "a-team", null))).toBe("leadRequired");
  });
  it("rejects stale source, stale board, inactive roster and invalid leads", () => {
    const s = setup();
    expect(decideCommand(s.board, roster, owner, move(0, "member-0", null, "a-team"))).toBe("changed");
    expect(decideCommand(s.board, roster, owner, move(s.board.version, "member-0", "b-team", "a-team"))).toBe("changed");
    expect(decideCommand(s.board, roster, owner, move(s.board.version, "departed", null, "a-team"))).toBe("memberUnavailable");
    expect(decideCommand(s.board, roster, owner, { kind: "replaceLead", teamId: "a-team", leadId: "member-0", expectedVersion: s.board.version })).toBe("leadRequired");
  });
});

describe("field-versioned immutable undo", () => {
  it("undoes old own work after unrelated work without requiring continued leadership", () => {
    const s = setup();
    const own = s.run(move(s.board.version, "member-0", null, "a-team"), officer);
    s.run({ kind: "rename", teamId: "b-team", name: "Unrelated", expectedVersion: s.board.version });
    const actor = { ...officer, linkedMemberIds: [] };
    const preview = previewUndo(s.board, s.events, roster, actor, own.id);
    expect(preview.actionIds).toEqual([own.id]);
    const result = confirmUndo(s.board, s.events, roster, actor, preview, { id: "undo", at: "2026-09-10T00:00:00.000Z", idempotencyKey: "undo-intent" });
    expect(readField(result.board, fieldKey("member", "member-0", "team"))).toBeNull();
    expect(readField(result.board, fieldKey("team", "b-team", "name"))).toBe("Unrelated");
    expect(own.reverses).toEqual([]);
    expect(result.event.reverses).toEqual([own.id]);
  });
  it("denies other-actor and represented-lead undo but allows explicit owner override", () => {
    const s = setup();
    const event = s.run(move(s.board.version, "member-0", null, "a-team"));
    expect(() => previewUndo(s.board, s.events, roster, officer, event.id)).toThrow("forbidden");
    expect(previewUndo(s.board, s.events, roster, owner, event.id).actionIds).toEqual([event.id]);
  });
  it("catches ABA and computes only necessary transitive cascades", () => {
    const s = setup();
    const root = s.run(move(s.board.version, "member-0", null, "a-team"), officer);
    const away = s.run(move(s.board.version, "member-0", "a-team", "b-team"));
    s.run({ kind: "rename", teamId: "b-team", name: "Keep", expectedVersion: s.board.version });
    const back = s.run(move(s.board.version, "member-0", "b-team", "a-team"));
    expect(() => previewUndo(s.board, s.events, roster, officer, root.id)).toThrow("dependencies");
    const preview = previewUndo(s.board, s.events, roster, owner, root.id);
    expect(preview.actionIds).toEqual([back.id, away.id, root.id]);
    const result = confirmUndo(s.board, s.events, roster, owner, preview, { id: "undo", at: "2026-09-10T00:00:00Z", idempotencyKey: "undo" });
    expect(readField(result.board, fieldKey("team", "b-team", "name"))).toBe("Keep");
    expect(readField(result.board, fieldKey("member", "member-0", "team"))).toBeNull();
  });
  it("rejects forged/stale preview and repeated reversal without modifying originals", () => {
    const s = setup();
    const root = s.run(move(s.board.version, "member-0", null, "a-team"), officer);
    const preview = previewUndo(s.board, s.events, roster, owner, root.id);
    expect(() => confirmUndo(s.board, s.events, roster, owner, { ...preview, actionIds: [] }, { id: "u", at: "now", idempotencyKey: "u" })).toThrow("changed");
    const undone = confirmUndo(s.board, s.events, roster, owner, preview, { id: "u", at: "now", idempotencyKey: "u" });
    expect(() => previewUndo(undone.board, [...s.events, undone.event], roster, owner, root.id)).toThrow("undone");
    s.run(move(s.board.version, "member-0", "a-team", null));
    expect(() => confirmUndo(s.board, s.events, roster, owner, preview, { id: "u", at: "now", idempotencyKey: "u" })).toThrow("changed");
  });
  it("preserves an independent owner rename when undoing a lead replacement", () => {
    const s = setup();
    const root = s.run({ kind: "replaceLead", teamId: "a-team", leadId: "next-lead", expectedVersion: s.board.version });
    s.run({ kind: "rename", teamId: "a-team", name: "Persistent", expectedVersion: s.board.version });
    expect(previewUndo(s.board, s.events, roster, owner, root.id).actionIds).toEqual([root.id]);
  });
  it("can undo earlier work after a dependent move was explicitly reversed", () => {
    const s = setup();
    const root = s.run(move(s.board.version, "member-0", null, "a-team"), officer);
    const later = s.run(move(s.board.version, "member-0", "a-team", "b-team"));
    const undone = confirmUndo(s.board, s.events, roster, owner, previewUndo(s.board, s.events, roster, owner, later.id), { id: "reversal", at: "now", idempotencyKey: "reversal" });
    s.board = undone.board;
    s.events.push(undone.event);
    expect(previewUndo(s.board, s.events, roster, officer, root.id).actionIds).toEqual([root.id]);
  });
  it("includes only the capacity-consuming dependent arrival when restoring a full team", () => {
    const s = setup();
    for (let i = 0; i < 16; i++) s.run(move(s.board.version, `member-${i}`, null, "a-team"));
    const root = s.run(move(s.board.version, "member-0", "a-team", null), officer);
    const arrival = s.run(move(s.board.version, "member-20", null, "a-team"));
    expect(() => previewUndo(s.board, s.events, roster, officer, root.id)).toThrow("dependencies");
    expect(previewUndo(s.board, s.events, roster, owner, root.id).actionIds).toEqual([arrival.id, root.id]);
  });
  it("never restores a departed member or an ineligible replaced lead", () => {
    const s = setup();
    s.run(move(s.board.version, "member-0", null, "a-team"));
    const removed = s.run(move(s.board.version, "member-0", "a-team", null));
    expect(() => previewUndo(s.board, s.events, roster.filter((m) => m.id !== "member-0"), owner, removed.id)).toThrow("invalid");
    const replacement = s.run({ kind: "replaceLead", teamId: "a-team", leadId: "next-lead", expectedVersion: s.board.version });
    expect(() => previewUndo(s.board, s.events, roster.map((m) => m.id === "lead-a" ? { ...m, rank: 3 } : m), owner, replacement.id)).toThrow("invalid");
  });
});

describe("unpublished setup lifecycle", () => {
  const setupRoster = [member("lead-1", 4), member("lead-2", 5), ...Array.from({ length: 6 }, (_, i) => member(`setup-${i}`))];
  function draft() {
    let board = emptyBoard("a");
    const events: SupportEvent[] = [];
    const run = (command: SupportCommand, actor = owner) => {
      const result = applyCommand(board, setupRoster, actor, command, { id: `action-${events.length}`, at: "2026-09-09T00:00:00.000Z", idempotencyKey: `intent-${events.length}` });
      board = result.board;
      events.push(result.event);
      return result.event;
    };
    return { get board() { return board; }, set board(value: SupportBoard) { board = value; }, events, run };
  }
  const create = (version: number, teamId: string, name: string, leadId: string): SupportCommand => ({ kind: "createTeam", teamId, name, leadId, expectedVersion: version });

  it("creates named teams with a unique eligible lead and assigns the lead atomically", () => {
    const s = draft();
    const event = s.run(create(0, "one", " First ", "lead-1"));
    expect(event.kind).toBe("createTeam");
    expect(readField(s.board, fieldKey("team", "one", "name"))).toBe("First");
    expect(memberTeam(s.board, "lead-1")).toBe("one");
    for (const [command, code] of [
      [create(s.board.version, "two", "", "lead-2"), "nameRequired"],
      [create(s.board.version, "two", "   ", "lead-2"), "nameRequired"],
      [create(s.board.version, "two", "x".repeat(61), "lead-2"), "nameLimit"],
      [create(s.board.version, "two", "Two", "lead-1"), "leadRequired"],
      [create(s.board.version, "two", "Two", "setup-0"), "leadRequired"],
      [create(s.board.version, "one", "Again", "lead-2"), "changed"],
      [create(0, "two", "Two", "lead-2"), "changed"],
    ] as const) expect(decideCommand(s.board, setupRoster, owner, command)).toBe(code);
    expect(decideCommand(s.board, setupRoster, officer, create(s.board.version, "two", "Two", "lead-2"))).toBe("forbidden");
    expect(() => s.run(create(s.board.version, "two", "Two", "lead-2"), { ...owner, allianceId: "other" })).toThrow("forbidden");
  });
  it("lets only override actors move members while unpublished", () => {
    const s = draft();
    s.run(create(s.board.version, "one", "One", "lead-1"));
    expect(decideCommand(s.board, setupRoster, officer, move(s.board.version, "setup-0", null, "one"))).toBe("forbidden");
    s.run(move(s.board.version, "setup-0", null, "one"));
    expect(memberTeam(s.board, "setup-0")).toBe("one");
  });
  it("deletes an empty setup team, returns its lead, and rejects occupied or published teams", () => {
    const s = draft();
    s.run(create(s.board.version, "one", "One", "lead-1"));
    s.run(create(s.board.version, "two", "Two", "lead-2"));
    s.run(move(s.board.version, "setup-0", null, "one"));
    expect(decideCommand(s.board, setupRoster, owner, { kind: "deleteTeam", teamId: "one", expectedVersion: s.board.version })).toBe("changed");
    expect(decideCommand(s.board, setupRoster, officer, { kind: "deleteTeam", teamId: "two", expectedVersion: s.board.version })).toBe("forbidden");
    expect(decideCommand(s.board, setupRoster, owner, { kind: "deleteTeam", teamId: "ghost", expectedVersion: s.board.version })).toBe("changed");
    s.run({ kind: "deleteTeam", teamId: "two", expectedVersion: s.board.version });
    expect(readField(s.board, fieldKey("team", "two", "exists"))).toBe(false);
    expect(readField(s.board, fieldKey("team", "two", "name"))).toBe("Two");
    expect(memberTeam(s.board, "lead-2")).toBeNull();
    s.board = { ...s.board, published: true };
    expect(decideCommand(s.board, setupRoster, owner, { kind: "deleteTeam", teamId: "one", expectedVersion: s.board.version })).toBe("changed");
  });
  it("publishes only a complete balanced setup and blocks ordinary officers", () => {
    const s = draft();
    const publish: SupportCommand = { kind: "publishSetup", expectedVersion: s.board.version };
    expect(decideCommand(s.board, setupRoster, owner, publish)).toBe("incomplete");
    s.run(create(s.board.version, "one", "One", "lead-1"));
    s.run(create(s.board.version, "two", "Two", "lead-2"));
    for (const [index, memberId] of ["setup-0", "setup-1", "setup-2"].entries()) s.run(move(s.board.version, memberId, null, index < 2 ? "one" : "two"));
    for (const memberId of ["setup-3", "setup-4"]) s.run(move(s.board.version, memberId, null, "two"));
    expect(decideCommand(s.board, setupRoster, owner, { ...publish, expectedVersion: s.board.version })).toBe("incomplete");
    s.run(move(s.board.version, "setup-5", null, "one"));
    expect(decideCommand(s.board, setupRoster, officer, { ...publish, expectedVersion: s.board.version })).toBe("forbidden");
    const event = s.run({ kind: "publishSetup", expectedVersion: s.board.version });
    expect(event.kind).toBe("publishSetup");
    expect(s.board.published).toBe(true);
    expect(decideCommand(s.board, setupRoster, owner, { kind: "publishSetup", expectedVersion: s.board.version })).toBe("changed");
  });
});
