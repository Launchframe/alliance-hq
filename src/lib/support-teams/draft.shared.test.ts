import { describe, expect, it } from "vitest";
import { supportTeamFields } from "@/lib/db/schema";
import { applyCommand, emptyBoard, fieldKey, fieldVersion, memberTeam, readField } from "./policy.shared";
import { activeReversals, confirmUndo, previewUndo } from "./history.shared";
import { applyDraftCommand, advanceDraft, draftSnapshot, draftMemberKey, draftSlotKey, draftKey } from "./draft.shared";
import type { DraftCommand } from "./draft.shared";
import type { SupportActor, SupportEvent, SupportRosterMember } from "./types.shared";

const start = Date.parse("2026-09-10T12:00:00Z");
const member = (id: string, rank = 3): SupportRosterMember => ({ id, name: id, previousNames: [], rank, country: null, professionLevel: null, baseLevel: null, basePower: null, kills: null, thp: null, tenureDays: null, hqLinked: false, discordLinked: false });
const roster = [member("lead-a", 4), member("lead-b", 5), ...Array.from({ length: 25 }, (_, i) => member(`m${i}`))];
const owner: SupportActor = { allianceId: "a", principalId: "owner", canRead: true, canWrite: true, override: true, linkedMemberIds: [] };
const officer = { ...owner, principalId: "officer", override: false, linkedMemberIds: ["lead-a"] };
function setup() {
  let board = emptyBoard("a");
  const events: SupportEvent[] = [];
  let serial = 0;
  const identity = (now: number) => ({ id: `e${serial++}`, at: new Date(now).toISOString(), idempotencyKey: `i${serial}` });
  for (const [teamId, leadId] of [["a-team", "lead-a"], ["b-team", "lead-b"]]) {
    const result = applyCommand(board, roster, owner, { kind: "createTeam", teamId, leadId, expectedVersion: board.version }, identity(start - 10000));
    board = result.board;
    events.push(result.event);
  }
  const run = (command: DraftCommand, actor = owner, now = start, currentRoster = roster) => {
    const result = applyDraftCommand(board, currentRoster, actor, command, identity(now));
    board = result.board;
    events.push(result.event);
    return result.event;
  };
  run({ kind: "scheduleDraft", draftId: "d", expectedVersion: board.version, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3600000).toISOString(), roundMinutes: 5 }, owner, start - 1000);
  const pick = (teamId: string, memberId: string): DraftCommand => ({ kind: "draftPick", draftId: "d", teamId, memberId, expectedRound: Number(readField(board, draftKey("d", "round"))), expectedRoundVersion: fieldVersion(board, draftKey("d", "round")), expectedMemberVersion: fieldVersion(board, draftMemberKey("d", memberId)), expectedSlotVersion: fieldVersion(board, draftSlotKey("d", Number(readField(board, draftKey("d", "round"))), teamId)) });
  return { get board() { return board; }, events, run, pick,
    advance(trigger: SupportEvent, now = start) { const result = advanceDraft(board, roster, "d", trigger.id, identity(now)); if (result) { board = result.board; events.push(result.event); } return result?.event; },
    undo(id: string, actor = owner, now = start) { const preview = previewUndo(board, events, roster, actor, id, now); const result = confirmUndo(board, events, roster, actor, preview, identity(now)); board = result.board; events.push(result.event); return result.event; },
  };
}

describe("scheduled draft workspace", () => {
  it("preserves trusted roster fingerprints through the Postgres JSONB driver round trip", () => {
    const s = setup();
    const column = supportTeamFields.value;
    for (const field of Object.values(s.board.fields)) {
      field.value = column.mapFromDriverValue(JSON.parse(column.mapToDriverValue(field.value) as string)) as typeof field.value;
    }
    expect(draftSnapshot(s.board, roster, owner, "d", start).rosterValid).toBe(true);
    expect(() => s.run(s.pick("a-team", "m0"))).not.toThrow();
    expect(() => s.run(s.pick("b-team", "m1"), owner, start, roster.map((m) => m.id === "m1" ? { ...m, draftStintToken: "new-stint" } : m))).toThrow("memberUnavailable");
  });
  it("lets current leadership schedule without granting ownership or publication authority", () => {
    const scheduled = applyDraftCommand(emptyBoard("a"), roster, officer, { kind: "scheduleDraft", draftId: "officer-draft", expectedVersion: 0, startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3600000).toISOString(), roundMinutes: 5 }, { id: "officer-schedule", at: new Date(start - 1000).toISOString(), idempotencyKey: "officer-schedule" });
    expect(scheduled.board.published).toBe(false);
    expect(scheduled.board.construction?.id).toBe("officer-draft");
    expect(draftSnapshot(scheduled.board, roster, officer, "officer-draft", start).actor.canManage).toBe(false);
  });
  it("preserves published fields and team identities, reserves every lead, and balances remainder seats without a ten cap", () => {
    const s = setup();
    const view = draftSnapshot(s.board, roster, owner, "d", start - 1);
    expect(view.phase).toBe("scheduled");
    expect(view.teams.map((t) => [t.id, t.target, t.memberIds])).toEqual([["a-team", 14, ["lead-a"]], ["b-team", 13, ["lead-b"]]]);
    expect(() => s.run(s.pick("a-team", "lead-b"))).toThrow("leadRequired");
    s.run(s.pick("a-team", "m0"));
    expect(memberTeam(s.board, "m0")).toBeNull();
  });
  it("allows only preparation before start and preserves work at the hard deadline until explicit extension", () => {
    const s = setup();
    expect(() => s.run(s.pick("a-team", "m0"), owner, start - 1)).toThrow("notOpen");
    s.run(s.pick("a-team", "m0"));
    expect(() => s.run(s.pick("b-team", "m1"), owner, start + 3600000)).toThrow("notOpen");
    expect(draftSnapshot(s.board, roster, owner, "d", start + 3600000).phase).toBe("expired");
    s.run({ kind: "extendDraft", draftId: "d", expectedVersion: s.board.version, endsAt: new Date(start + 7200000).toISOString() }, owner, start + 3600000);
    s.run(s.pick("b-team", "m1"), owner, start + 3600001);
  });
  it("accepts independent picks from one snapshot but rejects same-member and same-slot races", () => {
    const s = setup();
    const independent = s.pick("b-team", "m1");
    const contested = s.pick("b-team", "m0");
    const duplicateSlot = s.pick("a-team", "m2");
    s.run(s.pick("a-team", "m0"), officer);
    expect(() => s.run(contested)).toThrow("changed");
    expect(() => s.run(duplicateSlot)).toThrow("changed");
    s.run(independent);
  });
  it("permits own/owner proxies anytime and other officers only after the unfilled slot deadline", () => {
    const s = setup();
    expect(() => s.run(s.pick("b-team", "m0"), officer)).toThrow("proxyEarly");
    s.run(s.pick("b-team", "m0"), officer, start + 300000);
    expect(s.events.at(-1)?.context.representedLeadId).toBe("lead-b");
    expect(s.events.at(-1)?.principalId).toBe("officer");
  });
  it("rejects roster/rank/stint churn without consuming slots or partially publishing", () => {
    const s = setup();
    const command = s.pick("a-team", "m0");
    for (const changed of [roster.slice(1), [...roster, member("new")], roster.map((m) => m.id === "lead-a" ? { ...m, rank: 3 } : m)]) {
      expect(() => s.run(command, owner, start, changed)).toThrow();
    }
    expect(readField(s.board, draftSlotKey("d", 1, "a-team"))).toBeNull();
    expect(() => s.run({ kind: "publishDraft", draftId: "d", expectedVersion: s.board.version, allowUnsorted: false })).toThrow("changed");
    s.run(command);
    s.run({ kind: "publishDraft", draftId: "d", expectedVersion: s.board.version, allowUnsorted: true });
    expect(s.board.published).toBe(true);
    expect(s.board.construction).toBeNull();
    expect(memberTeam(s.board, "m0")).toBe("a-team");
    expect(memberTeam(s.board, "m1")).toBeNull();
  });
  it("finishes the final remainder round without drafting leads again or autofilling", () => {
    const s = setup();
    let index = 0;
    while (index < 25) {
      const view = draftSnapshot(s.board, roster, owner, "d", start);
      for (const team of view.teams.filter((item) => item.applicable)) {
        const event = s.run(s.pick(team.id, `m${index++}`));
        s.advance(event);
      }
    }
    const view = draftSnapshot(s.board, roster, owner, "d", start);
    expect(view.phase).toBe("ready");
    expect(view.teams.map((team) => team.memberIds.length)).toEqual([14, 13]);
    expect(new Set(view.teams.flatMap((team) => team.memberIds)).size).toBe(27);
    expect(s.board.published).toBe(false);
    s.run({ kind: "publishDraft", draftId: "d", expectedVersion: s.board.version, allowUnsorted: false });
    expect(s.board.published).toBe(true);
  });
  it("keeps valid working picks visible but blocks settlement when a different member departs", () => {
    const s = setup();
    s.run(s.pick("a-team", "m0"));
    const changed = roster.filter((m) => m.id !== "m1");
    const view = draftSnapshot(s.board, changed, owner, "d", start);
    expect(view.rosterValid).toBe(false);
    expect(view.memberLocations.m0).toBe("a-team");
    expect(() => s.run({ kind: "publishDraft", draftId: "d", expectedVersion: s.board.version, allowUnsorted: true }, owner, start, changed)).toThrow("memberUnavailable");
  });
  it("denies structural officer writes, cross-tenant and revoked linked leads", () => {
    const s = setup();
    expect(() => s.run({ kind: "cancelDraft", draftId: "d", expectedVersion: s.board.version }, officer)).toThrow("forbidden");
    for (const actor of [{ ...officer, allianceId: "other" }, { ...officer, canWrite: false }]) expect(() => s.run(s.pick("a-team", "m0"), actor)).toThrow("forbidden");
    expect(() => draftSnapshot(s.board, roster, { ...officer, canRead: false }, "d", start)).toThrow("forbidden");
  });
});

describe("draft history causality and compensations", () => {
  it("creates a separate system advance and cascades it and later work, preserving the independent triggering pick", () => {
    const s = setup();
    const first = s.run(s.pick("a-team", "m0"), officer);
    const last = s.run(s.pick("b-team", "m1"));
    const advance = s.advance(last)!;
    expect(advance.principalType).toBe("service");
    expect(advance.context.sourceActionId).toBe(last.id);
    const later = s.run(s.pick("a-team", "m2"));
    expect(() => previewUndo(s.board, s.events, roster, officer, first.id, start)).toThrow("dependencies");
    expect(previewUndo(s.board, s.events, roster, owner, first.id, start).actionIds).toEqual([later.id, advance.id, first.id]);
    s.undo(first.id);
    expect(readField(s.board, draftMemberKey("d", "m1"))).toBe("b-team");
    expect(readField(s.board, draftMemberKey("d", "m2"))).toBeNull();
    expect(readField(s.board, draftKey("d", "round"))).toBe(1);
  });
  it("allows old own picks after unrelated work and immutable undo-of-undo cycles", () => {
    const s = setup();
    const first = s.run(s.pick("a-team", "m0"), officer);
    s.run(s.pick("b-team", "m1"));
    expect(() => s.undo(first.id, { ...officer, principalId: "other" })).toThrow("forbidden");
    const reversal = s.undo(first.id, officer);
    expect(activeReversals(s.events).get(first.id)).toBe(reversal.id);
    s.undo(reversal.id, officer);
    expect(activeReversals(s.events).has(first.id)).toBe(false);
    const again = s.undo(first.id, officer);
    expect(activeReversals(s.events).get(first.id)).toBe(again.id);
    expect(first.reverses).toEqual([]);
  });
  it("does not block an independent name inverse merely because a construction deadline expired", () => {
    const s = setup();
    const renamed = applyCommand(s.board, roster, owner, { kind: "rename", teamId: "a-team", name: "Keep identity", expectedVersion: s.board.version }, { id: "rename", at: new Date(start).toISOString(), idempotencyKey: "rename" });
    const preview = previewUndo(renamed.board, [...s.events, renamed.event], roster.slice(1), owner, renamed.event.id, start + 3600000);
    expect(preview.actionIds).toEqual([renamed.event.id]);
    expect(preview.patches).toHaveLength(1);
  });
  it("cascades a later reversal cycle rather than creating duplicate active reversals", () => {
    const s = setup();
    const first = s.run(s.pick("a-team", "m0"), officer);
    const reversed = s.undo(first.id, officer);
    const restored = s.undo(reversed.id, officer);
    const again = s.undo(first.id, officer);
    expect(() => previewUndo(s.board, s.events, roster, officer, restored.id, start)).toThrow("dependencies");
    expect(previewUndo(s.board, s.events, roster, owner, restored.id, start).actionIds).toEqual([again.id, restored.id]);
    s.undo(restored.id);
    expect(activeReversals(s.events).get(first.id)).toBe(reversed.id);
    expect(readField(s.board, draftMemberKey("d", "m0"))).toBeNull();
  });
  it("rejects a stale undo preview after a round transition and includes publication as a dependency", () => {
    const s = setup();
    const first = s.run(s.pick("a-team", "m0"), officer);
    const preview = previewUndo(s.board, s.events, roster, owner, first.id, start);
    const last = s.run(s.pick("b-team", "m1"));
    s.advance(last);
    expect(() => confirmUndo(s.board, s.events, roster, owner, preview, { id: "stale", at: new Date(start).toISOString(), idempotencyKey: "stale" })).toThrow("changed");
    const published = s.run({ kind: "publishDraft", draftId: "d", expectedVersion: s.board.version, allowUnsorted: true });
    expect(previewUndo(s.board, s.events, roster, owner, first.id, start).actionIds).toContain(published.id);
    s.undo(first.id);
    expect(s.board.published).toBe(false);
    expect(s.board.construction).toEqual({ kind: "draft", id: "d" });
    expect(readField(s.board, draftMemberKey("d", "m1"))).toBe("b-team");
  });
  it("never reopens canceled or published expired work through undo or undo-of-undo", () => {
    for (const kind of ["cancelDraft", "publishDraft"] as const) {
      const s = setup();
      const event = s.run({ kind, draftId: "d", expectedVersion: s.board.version, allowUnsorted: true });
      expect(() => s.undo(event.id, owner, start + 3600000)).toThrow("notOpen");
    }
    const s = setup();
    const first = s.run(s.pick("a-team", "m0"), officer);
    const reversal = s.undo(first.id, officer);
    expect(() => s.undo(reversal.id, officer, start + 3600000)).toThrow("notOpen");
  });
  it("rejects expired inverse lifecycle and ABA round snapshots", () => {
    const s = setup();
    const first = s.run(s.pick("a-team", "m0"));
    const old = s.pick("b-team", "m1");
    const last = s.run(s.pick("b-team", "m2"));
    const advance = s.advance(last)!;
    s.undo(advance.id);
    expect(() => s.run(old)).toThrow("changed");
    expect(() => s.undo(first.id, owner, start + 3600000)).toThrow("notOpen");
    expect(fieldVersion(s.board, fieldKey("board", "a", "constructionId"))).toBeGreaterThan(0);
  });
});
