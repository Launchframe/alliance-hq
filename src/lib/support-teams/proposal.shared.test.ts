import { describe, expect, it } from "vitest";
import { supportTeamFields } from "@/lib/db/schema";
import { applyProposalCommand, proposalSnapshot, type ProposalCommand } from "./proposal.shared";
import { applyCommand, emptyBoard, fieldKey, readField } from "./policy.shared";
import { confirmUndo, previewUndo } from "./history.shared";
import type { SupportActor, SupportBoard, SupportEvent, SupportRosterMember } from "./types.shared";

const officer: SupportActor = { allianceId: "a", principalId: "u0", canRead: true, canWrite: true, override: false, linkedMemberIds: ["r0"] };
const owner = { ...officer, principalId: "owner", override: true };
const member = (id: string, rank: number, voters: string[] = []): SupportRosterMember => ({ id, rank, name: id, previousNames: [], country: null, professionLevel: null, baseLevel: null, basePower: null, kills: null, thp: null, tenureDays: null, hqLinked: false, discordLinked: false, draftStintToken: `stint:${id}`, proposalVoterIds: voters });
function fixture(n = 4) {
  const roster = Array.from({ length: n }, (_, i) => member(`r${i}`, 4, [`u${i}`]));
  if (!n) roster.push(member("r0", 5));
  let board: SupportBoard = emptyBoard("a");
  const events: SupportEvent[] = [];
  const run = (command: ProposalCommand, actor = officer) => {
    const result = applyProposalCommand(board, roster, actor, command, { id: `e${events.length}`, at: "2026-09-10T00:00:00Z", idempotencyKey: `k${events.length}` });
    board = result.board; events.push(result.event); return result.event;
  };
  const view = (id = "p", actor = officer) => proposalSnapshot(board, roster, actor, id);
  const action = (kind: "submitProposal" | "approveProposal" | "cancelProposal", actor = officer, id = "p") => run({ kind, proposalId: id, expectedVersion: view(id).proposalVersion }, actor);
  run({ kind: "createProposal", proposalId: "p", expectedVersion: 0 });
  const publish = (override = false, actor = owner, id = "p") => run({ kind: "publishProposal", proposalId: id, expectedVersion: view(id).proposalVersion, expectedPublishedVersion: view(id).publishedVersion, override }, actor);
  return { roster, run, view, action, publish, events, board: () => board };
}

describe("freehand proposal approval policy", () => {
  it("preserves approval fingerprints through the Postgres JSONB driver without weakening invalidation", () => {
    const f = fixture();
    const roundTrip = () => {
      const column = supportTeamFields.value;
      for (const field of Object.values(f.board().fields)) {
        field.value = column.mapFromDriverValue(JSON.parse(column.mapToDriverValue(field.value) as string)) as typeof field.value;
      }
    };
    f.action("submitProposal");
    roundTrip();
    expect(f.view()).toMatchObject({ invalidated: false, canApprove: true });
    for (let i = 0; i < 3; i++) {
      f.action("approveProposal", { ...officer, principalId: `u${i}` });
      roundTrip();
    }
    expect(f.view()).toMatchObject({ invalidated: false, approved: 3, canPublish: true });
    for (const change of [{ draftStintToken: "new-stint" }, { proposalIdentityToken: "new-proof" }, { proposalVoterIds: ["replacement"] }, { rank: 3 }]) {
      const original = { ...f.roster[0] };
      Object.assign(f.roster[0], change);
      expect(f.view()).toMatchObject({ invalidated: true, approved: 0, canPublish: false });
      expect(() => f.publish(true)).toThrow();
      f.roster[0] = original;
    }
    f.publish();
    roundTrip();
    expect(f.view()).toMatchObject({ phase: "published", invalidated: false, approved: 3 });
  });
  it("rejects exactly half, includes offline/unlinked R4s, and requires a strict majority", () => {
    const f = fixture(); f.roster[3].proposalVoterIds = []; f.action("submitProposal");
    for (let i = 0; i < 2; i++) f.action("approveProposal", { ...officer, principalId: `u${i}` });
    expect(f.view()).toMatchObject({ electorateCount: 4, required: 3, approved: 2, canPublish: false });
    expect(() => f.publish()).toThrow("forbidden");
    f.action("approveProposal", { ...officer, principalId: "u2" }); f.publish();
    expect(f.board().published).toBe(true);
  });
  it("counts one proven human across sessions and commanders without shrinking denominator", () => {
    const f = fixture(); f.roster[1].proposalVoterIds = ["u0"]; f.action("submitProposal"); f.action("approveProposal");
    expect(() => f.action("approveProposal")).toThrow("changed");
    expect(f.view()).toMatchObject({ approved: 1, required: 3, electorateCount: 4 });
  });
  it("blocks binding collisions pending reconciliation or explicit owner review", () => {
    const f = fixture(); f.roster[0].proposalVoterIds = ["u0", "other"]; f.action("submitProposal");
    expect(() => f.action("approveProposal")).toThrow("forbidden");
    expect(f.view()).toMatchObject({ identityReviewRequired: true, electorateCount: 4 }); f.publish(true);
    expect(f.events.at(-1)?.context.ownerOverride).toBe(true);
  });
  it("invalidates approval on identity and current electorate changes", () => {
    const f = fixture(); f.action("submitProposal"); f.action("approveProposal");
    f.roster[0].proposalVoterIds = ["replacement"];
    expect(f.view()).toMatchObject({ approved: 0, invalidated: true });
    expect(() => f.action("approveProposal")).toThrow("changed");
    expect(() => f.publish(true)).toThrow("changed");
    expect(f.view("p", owner).canOverride).toBe(false);
    f.roster.push(member("new", 4)); expect(f.view().electorateCount).toBe(5);
  });
  it("requires explicit authorized override, including with zero R4s", () => {
    const f = fixture(0); f.action("submitProposal");
    expect(() => f.publish()).toThrow("forbidden");
    expect(() => f.publish(true, officer)).toThrow("forbidden");
    f.publish(true); expect(f.view().phase).toBe("published");
  });
  it("isolates competing workspaces and rejects publication of an old base", () => {
    const f = fixture(); f.run({ kind: "createProposal", proposalId: "q", expectedVersion: f.board().version });
    f.action("submitProposal"); f.action("submitProposal", officer, "q"); f.publish(true);
    expect(f.view("q").stale).toBe(true); expect(() => f.publish(true, owner, "q")).toThrow("changed");
  });
  it("enforces tenant and HQ write permissions rather than game rank", () => {
    const f = fixture();
    for (const actor of [{ ...officer, allianceId: "b" }, { ...officer, canWrite: false }, { ...officer, principalId: "" }]) expect(() => f.action("submitProposal", actor)).toThrow("forbidden");
  });
  it("requires complete balanced allocation and keeps new stints unsorted", () => {
    const f = fixture(2); f.roster.push(member("new", 1));
    expect(() => f.action("submitProposal")).toThrow("incomplete");
    const team = f.view().teams[0];
    f.run({ kind: "moveProposal", proposalId: "p", expectedVersion: f.view().proposalVersion, memberId: "new", from: null, to: team.id });
    f.action("submitProposal"); f.action("approveProposal");
    f.roster.find((m) => m.id === "new")!.draftStintToken = "rejoin";
    expect(f.view().memberLocations.new).toBeNull(); expect(f.view().approved).toBe(0);
    expect(() => f.publish(true)).toThrow("incomplete");
  });
  it("never moves lead seats and never treats unknown stats as zero", () => {
    const f = fixture(); const view = f.view();
    expect(view.roster[0].thp).toBeNull(); expect(view.roster[0]).not.toHaveProperty("proposalVoterIds"); expect(view.roster[0]).not.toHaveProperty("draftStintToken");
    expect(() => f.run({ kind: "moveProposal", proposalId: "p", expectedVersion: view.proposalVersion, memberId: "r0", from: view.memberLocations.r0, to: null })).toThrow("leadRequired");
  });
  it("balances above ten seats with visible remainders and rejects stale sources", () => {
    const f = fixture(2); for (let i = 0; i < 23; i++) f.roster.push(member(`m${i}`, 1));
    expect(f.view().teams.map((t) => t.target)).toEqual([13, 12]);
    const initial = f.view();
    for (const m of f.roster.filter((m) => m.rank === 1)) {
      const view = f.view(); const target = view.teams.find((t) => t.memberIds.length < t.target)!;
      f.run({ kind: "moveProposal", proposalId: "p", expectedVersion: view.proposalVersion, memberId: m.id, from: null, to: target.id });
    }
    expect(f.view().complete).toBe(true);
    expect(new Set(f.view().teams.flatMap((t) => t.memberIds)).size).toBe(25);
    expect(() => f.run({ kind: "moveProposal", proposalId: "p", expectedVersion: initial.proposalVersion, memberId: "m0", from: null, to: initial.teams[0].id })).toThrow("changed");
  });
  it("edits invalidate all approvals and their reversal cannot resurrect old approval versions", () => {
    const f = fixture(2); f.roster.push(member("m0", 1), member("m1", 1));
    for (const [i, id] of ["m0", "m1"].entries()) f.run({ kind: "moveProposal", proposalId: "p", expectedVersion: f.view().proposalVersion, memberId: id, from: null, to: f.view().teams[i].id });
    f.action("submitProposal"); f.action("approveProposal");
    const before = f.view(); const edit = f.run({ kind: "swapProposal", proposalId: "p", expectedVersion: before.proposalVersion, memberId: "m0", otherMemberId: "m1", from: before.memberLocations.m0!, to: before.memberLocations.m1! });
    expect(f.view()).toMatchObject({ invalidated: true, approved: 0, phase: "editing" });
    const preview = previewUndo(f.board(), f.events, f.roster, officer, edit.id);
    const undone = confirmUndo(f.board(), f.events, f.roster, officer, preview, { id: "undo-edit", at: "2026-09-10T00:00:00Z", idempotencyKey: "undo-edit" });
    expect(proposalSnapshot(undone.board, f.roster, officer, "p")).toMatchObject({ approved: 0, invalidated: true });
  });
  it("reverses one independent vote without revoking another person's vote", () => {
    const f = fixture(); f.action("submitProposal"); const first = f.action("approveProposal"); const second = f.action("approveProposal", { ...officer, principalId: "u1" });
    const preview = previewUndo(f.board(), f.events, f.roster, officer, first.id);
    expect(preview.actionIds).toEqual([first.id]); expect(preview.actionIds).not.toContain(second.id);
    const result = confirmUndo(f.board(), f.events, f.roster, officer, preview, { id: "undo-vote", at: "2026-09-10T00:00:00Z", idempotencyKey: "undo-vote" });
    expect(proposalSnapshot(result.board, f.roster, officer, "p").approved).toBe(1);
  });
  it("redoes an independent vote without changing original actor attribution", () => {
    const f = fixture(); f.action("submitProposal"); const vote = f.action("approveProposal");
    const original = structuredClone(vote);
    const preview = previewUndo(f.board(), f.events, f.roster, owner, vote.id);
    const undone = confirmUndo(f.board(), f.events, f.roster, owner, preview, { id: "undo-vote", at: "2026-09-10T00:00:00Z", idempotencyKey: "undo-vote" });
    expect(proposalSnapshot(undone.board, f.roster, officer, "p").approved).toBe(0);
    const events = [...f.events, undone.event];
    const redo = previewUndo(undone.board, events, f.roster, owner, undone.event.id);
    const restored = confirmUndo(undone.board, events, f.roster, owner, redo, { id: "redo-vote", at: "2026-09-10T00:00:00Z", idempotencyKey: "redo-vote" });
    expect(proposalSnapshot(restored.board, f.roster, officer, "p").approved).toBe(1);
    expect(vote).toEqual(original);
    expect(vote.principalId).toBe(officer.principalId);
    expect(restored.event.principalId).toBe(owner.principalId);
  });
  it("publication reversal preserves unrelated persistent team names", () => {
    const f = fixture(1); f.action("submitProposal"); f.publish(true);
    f.run({ kind: "createProposal", proposalId: "q", expectedVersion: f.board().version }); f.action("submitProposal", officer, "q");
    const publication = f.publish(true, owner, "q");
    const renamed = applyCommand(f.board(), f.roster, owner, { kind: "rename", teamId: f.view("q").teams[0].id, name: "Persistent name", expectedVersion: f.board().version }, { id: "rename", at: "2026-09-10T00:00:00Z", idempotencyKey: "rename" });
    const preview = previewUndo(renamed.board, [...f.events, renamed.event], f.roster, owner, publication.id);
    expect(preview.actionIds).not.toContain(renamed.event.id);
    const undone = confirmUndo(renamed.board, [...f.events, renamed.event], f.roster, owner, preview, { id: "undo", at: "2026-09-10T00:00:00Z", idempotencyKey: "undo" });
    expect(readField(undone.board, fieldKey("team", f.view("q").teams[0].id, "name"))).toBe("Persistent name");
  });
  it("approval reversal requires the exact owner-reviewed dependent publication chain", () => {
    const f = fixture(1); f.action("submitProposal"); const vote = f.action("approveProposal"); const publication = f.publish(false, officer);
    expect(() => previewUndo(f.board(), f.events, f.roster, officer, vote.id)).toThrow("dependencies");
    const preview = previewUndo(f.board(), f.events, f.roster, owner, vote.id);
    expect(preview.actionIds).toContain(publication.id);
    const undone = confirmUndo(f.board(), f.events, f.roster, owner, preview, { id: "undo", at: "2026-09-10T00:00:00Z", idempotencyKey: "undo" });
    expect(undone.board.published).toBe(false);
    expect(readField(undone.board, fieldKey("member", "r0", "team"))).toBeNull();
  });
});
