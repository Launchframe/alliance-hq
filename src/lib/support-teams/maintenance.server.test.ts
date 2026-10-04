import { describe, expect, it } from "vitest";
import { confirmUndo, previewUndo } from "./history.shared";
import { applyStintCommand, assertMembershipUndo, projectMemberships, publicBoard, publicEvent, publicUndoPreview, reconcileMemberships, SUPPORT_MEMBERSHIP_SERVICE } from "./maintenance.server";
import { emptyBoard, fieldKey, memberTeam, readField, teamLead } from "./policy.shared";
import type { SupportActor, SupportBoard, SupportCommand, SupportEvent, SupportRosterMember } from "./types.shared";

const member = (id: string, rank = 3): SupportRosterMember => ({ id, rank, name: id, previousNames: [], country: null, professionLevel: null, baseLevel: null, basePower: null, kills: null, thp: null, tenureDays: null, hqLinked: false, discordLinked: false });
const owner: SupportActor = { allianceId: "a", principalId: "owner", override: true, canRead: true, canWrite: true, linkedMemberIds: [] };
const officer: SupportActor = { ...owner, principalId: "officer", override: false, linkedMemberIds: ["lead"] };
function fixture() {
  let board = emptyBoard("a");
  let roster = [member("lead", 4), member("next", 5), member("member"), member("spare")];
  let stints: Record<string, string> = Object.fromEntries(roster.map((row) => [row.id, `private-${row.id}-stint-1`]));
  const events: SupportEvent[] = [];
  const identity = () => ({ id: `event-${events.length}`, idempotencyKey: `intent-${events.length}`, at: "2026-09-08T00:00:00Z" });
  const reconcile = () => {
    const result = reconcileMemberships(board, roster, stints, identity());
    if (result) { board = result.board; events.push(result.event); }
    return result;
  };
  const run = (command: Omit<SupportCommand, "expectedVersion"> & Record<string, unknown>, actor = owner) => {
    const result = applyStintCommand(board, roster, actor, { ...command, expectedVersion: board.version } as SupportCommand, identity());
    board = result.board;
    events.push(result.event);
    return result.event;
  };
  reconcile();
  run({ kind: "createTeam", teamId: "team", leadId: "lead" });
  run({ kind: "rename", teamId: "team", name: "Persistent" }, officer);
  board = { ...board, published: true };
  run({ kind: "move", memberId: "member", from: null, to: "team" });
  return { get board() { return board; }, set board(value: SupportBoard) { board = value; }, get roster() { return roster; }, set roster(value: SupportRosterMember[]) { roster = value; }, get stints() { return stints; }, set stints(value: Record<string, string>) { stints = value; }, events, run, reconcile, project: () => projectMemberships(board, roster, stints) };
}

describe("current-stint maintenance", () => {
  it.each([false, true])("archives departure/rejoin under the same roster ID with intermediate poll=%s", (poll) => {
    const f = fixture();
    const original = JSON.stringify(f.events);
    f.roster = f.roster.filter((row) => row.id !== "member");
    expect(memberTeam(f.project(), "member")).toBeNull();
    expect(memberTeam(f.board, "member")).toBe("team");
    if (poll) f.reconcile();
    f.roster = [...f.roster, member("member")];
    f.stints = { ...f.stints, member: "private-member-stint-2" };
    expect(memberTeam(f.project(), "member")).toBeNull();
    const consequence = f.reconcile()!;
    expect(consequence.event).toMatchObject({ kind: "reconcile", principalId: SUPPORT_MEMBERSHIP_SERVICE, actorType: "service", reverses: [] });
    expect(memberTeam(f.board, "member")).toBeNull();
    expect(f.reconcile()).toBeNull();
    expect(JSON.stringify(f.events.slice(0, JSON.parse(original).length))).toBe(original);
  });
  it("leaves new and unproven members unassigned, without inferring stint from tenure days", () => {
    const f = fixture();
    f.roster = [...f.roster, member("new")];
    f.stints = { ...f.stints, new: "private-new-stint" };
    delete f.stints.member;
    expect(memberTeam(f.project(), "member")).toBeNull();
    expect(memberTeam(f.project(), "new")).toBeNull();
    f.reconcile();
    expect(() => f.run({ kind: "move", memberId: "member", from: null, to: "team" })).toThrow("memberUnavailable");
    expect(f.roster.find((row) => row.id === "member")?.tenureDays).toBeNull();
  });
  it("projects legacy assignments without provenance as stale", () => {
    const f = fixture();
    delete f.board.fields[fieldKey("member", "member", "assignmentStint")];
    expect(memberTeam(f.project(), "member")).toBeNull();
  });
  it.each(["rank", "departure"])("preserves the team/name and vacates an ineligible lead after %s", (reason) => {
    const f = fixture();
    f.roster = reason === "rank" ? f.roster.map((row) => row.id === "lead" ? { ...row, rank: 3 } : row) : f.roster.filter((row) => row.id !== "lead");
    expect(teamLead(f.project(), "team")).toBeNull();
    f.reconcile();
    expect(readField(f.board, fieldKey("team", "team", "exists"))).toBe(true);
    expect(readField(f.board, fieldKey("team", "team", "name"))).toBe("Persistent");
    expect(() => f.run({ kind: "rename", teamId: "team", name: "Forbidden" }, officer)).toThrow("forbidden");
  });
  it("does not silently return a departing lead but permits explicit same-lead replacement", () => {
    const f = fixture();
    f.stints = { ...f.stints, lead: "private-lead-stint-2" };
    expect(teamLead(f.project(), "team")).toBeNull();
    f.reconcile();
    expect(() => f.run({ kind: "replaceLead", teamId: "team", leadId: "lead" }, officer)).toThrow("forbidden");
    f.run({ kind: "replaceLead", teamId: "team", leadId: "lead" });
    expect(teamLead(f.board, "team")).toBe("lead");
    expect(memberTeam(f.board, "lead")).toBe("team");
    f.run({ kind: "rename", teamId: "team", name: "Renamed" }, officer);
  });
  it("allows the owner to add a lead after publication but denies another officer and locks construction", () => {
    const f = fixture();
    const command = { kind: "createTeam" as const, teamId: "next-team", leadId: "next" };
    expect(() => f.run(command, officer)).toThrow("forbidden");
    f.board = { ...f.board, construction: { kind: "draft", id: "draft" } };
    expect(() => f.run(command)).toThrow("changed");
    f.board = { ...f.board, construction: null };
    expect(f.run(command).context.mode).toBe("maintenance");
    expect(readField(f.board, fieldKey("team", "team", "name"))).toBe("Persistent");
    expect(memberTeam(f.board, "member")).toBe("team");
  });
});

describe("external membership fences and public contracts", () => {
  it.each([false, true])("cannot undo old unassignment into a returned stint, reconciled=%s", (reconciled) => {
    const f = fixture();
    const removal = f.run({ kind: "move", memberId: "member", from: "team", to: null });
    f.stints = { ...f.stints, member: "private-member-stint-2" };
    if (reconciled) f.reconcile();
    expect(() => previewUndo(f.project(), f.events, f.roster, owner, removal.id)).toThrow();
    expect(readField(f.project(), fieldKey("membership", "member", "stint"))).toBe("private-member-stint-2");
  });
  it("cannot restore a legacy unassignment when the current stint has no trusted proof", () => {
    const f = fixture();
    const removal = f.run({ kind: "move", memberId: "member", from: "team", to: null });
    delete f.stints.member;
    f.board = publicBoard(f.board);
    expect(() => previewUndo(f.project(), f.events.map(publicEvent), f.roster, owner, removal.id)).toThrow("memberUnavailable");
  });
  it("cannot cascade through an external consequence or undo that event directly, even with owner override", () => {
    const f = fixture();
    const move = f.events.at(-1)!;
    f.stints = { ...f.stints, member: "private-member-stint-2" };
    const consequence = f.reconcile()!;
    expect(() => previewUndo(f.board, f.events, f.roster, owner, move.id)).toThrow("dependencies");
    expect(() => previewUndo(f.board, f.events, f.roster, owner, consequence.event.id)).toThrow("dependencies");
    expect(() => assertMembershipUndo({ rootActionId: consequence.event.id, actionIds: [consequence.event.id], expectedVersions: {}, patches: [] }, f.events)).toThrow("dependencies");
  });
  it("retains normal own-action undo and removes private provenance from every public DTO", () => {
    const f = fixture();
    const move = f.events.at(-1)!;
    const preview = previewUndo(f.board, f.events, f.roster, owner, move.id);
    const undone = confirmUndo(f.board, f.events, f.roster, owner, preview, { id: "undo", at: "now", idempotencyKey: "undo" });
    expect(memberTeam(undone.board, "member")).toBeNull();
    expect(readField(undone.board, fieldKey("membership", "member", "stint"))).toBe("private-member-stint-1");
    for (const dto of [publicBoard(f.board), ...f.events.map(publicEvent), publicUndoPreview(preview), publicEvent(undone.event)]) {
      expect(JSON.stringify(dto)).not.toMatch(/private-|assignmentStint|\\"membership\\"|game_?uid/);
    }
  });
});
