import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptSnapshot, commandEligibility, countryPresentation, locationOf, moveCommand, ownTeamId, supportErrorKey, supportRequest, swipeDirection } from "./board-client.shared";
import { defaultDisplayPreferences, matchesUnsortedFilters } from "./display-preferences.shared";
import { applyCommand, emptyBoard, fieldKey } from "./policy.shared";
import { applyDraftCommand, draftSnapshot } from "./draft.shared";
import { draftBoardInteractions, workingDraftSnapshot, canPickDraftMember, draftWorkspaceKey, acceptsDraftSnapshot } from "./board-client.shared";
import { historyKindLabels, historyNames, historyServiceLabel, humanizePatch, undoConfirmation } from "./history-client.shared";
import type { SupportActor, SupportEvent, SupportRosterMember, SupportSnapshot } from "./types.shared";

const member = (id: string, rank = 3): SupportRosterMember => ({ id, rank, name: `Name ${id}`, previousNames: ["Old name"], country: null, professionLevel: null, baseLevel: null, basePower: 99000, kills: null, thp: 123, tenureDays: null, hqLinked: false, discordLinked: false });
function fixture() {
  const actor: SupportActor = { allianceId: "alliance", principalId: "owner", canRead: true, canWrite: true, override: true, linkedMemberIds: ["lead-a"] };
  const roster = [member("lead-a", 4), member("lead-b", 5), member("one"), member("two"), member("three"), member("four")];
  let board = emptyBoard("alliance");
  for (const id of ["a", "b"]) board = applyCommand(board, roster, actor, { kind: "createTeam", teamId: id, leadId: `lead-${id}`, expectedVersion: board.version }, { id, at: "2026-01-01T00:00:00Z", idempotencyKey: id }).board;
  board.published = true;
  const snapshot: SupportSnapshot = { version: board.version, published: true, board, actor, roster, canWrite: true, linkedMemberIds: actor.linkedMemberIds, teams: ["a", "b"].map((id) => ({ id, name: id === "a" ? "Alpha" : "Bravo", leadId: `lead-${id}`, memberIds: [`lead-${id}`], target: 3, needsReplacement: false })) };
  return snapshot;
}

afterEach(() => vi.unstubAllGlobals());
describe("support board client contracts", () => {
  function draftFixture() {
    const published = fixture();
    const now = Date.parse("2026-09-10T12:00:00Z");
    const board = applyDraftCommand(published.board!, published.roster, published.actor!, { kind: "scheduleDraft", draftId: "draft", expectedVersion: published.version, startsAt: new Date(now).toISOString(), endsAt: new Date(now + 3600000).toISOString(), roundMinutes: 5 }, { id: "schedule", at: new Date(now - 1000).toISOString(), idempotencyKey: "schedule" }).board;
    const live = { ...published, board, version: board.version };
    const draft = draftSnapshot(board, live.roster, { ...live.actor!, override: false }, "draft", now);
    return { live, draft, now };
  }
  it("projects an isolated working allocation without live command authority", () => {
    const { draft, live } = draftFixture();
    draft.memberLocations.one = "a";
    draft.teams[0].memberIds.push("one");
    const working = workingDraftSnapshot(draft);
    expect(locationOf(working, "one")).toBe("a");
    expect(locationOf(live, "one")).toBeNull();
    expect(working.board).toBeUndefined();
    expect(working.actor).toBeUndefined();
    expect(ownTeamId(working)).toBe("a");
  });
  it("routes drag, search and mobile moves only through the pick adapter and permits persistent renames only", () => {
    const { draft, live, now } = draftFixture();
    const pick = vi.fn().mockResolvedValue(true);
    const execute = vi.fn();
    const adapter = { pick, canPickMember: (team: string, member: string) => canPickDraftMember(draft, team, member, now, []) };
    const interactions = draftBoardInteractions(adapter, live, execute);
    expect(interactions.eligibility("one", "a")).toBeNull();
    interactions.onMove("one", "a");
    interactions.onMove("one", null);
    interactions.onMove("lead-a", "b");
    interactions.onMove("one", "a", "two");
    expect(pick).toHaveBeenCalledExactlyOnceWith("a", "one");
    expect(execute).not.toHaveBeenCalled();
    const rename = { kind: "rename" as const, teamId: "a", name: "Cedar", expectedVersion: 0 };
    expect(interactions.canCommand(rename)).toBe(true);
    interactions.onCommand(rename, "a");
    expect(execute).toHaveBeenCalledWith({ ...rename, expectedVersion: live.version }, "a");
    expect(interactions.canCommand({ ...rename, teamId: "unpublished-new-team" })).toBe(false);
    interactions.onCommand(moveCommand(live, "two", "a"), "a");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("reevaluates preparation, proxy deadlines, expiry, pending slots and member eligibility against the clock", () => {
    const { draft, now } = draftFixture();
    expect(canPickDraftMember(draft, "a", "one", now, [])).toBe(true);
    expect(canPickDraftMember(draft, "b", "one", now, [])).toBe(false);
    expect(canPickDraftMember(draft, "b", "one", now + 300000, [])).toBe(true);
    expect(canPickDraftMember(draft, "a", "one", now + 3600000, [])).toBe(false);
    expect(canPickDraftMember(draft, "a", "one", now, ["a"])).toBe(false);
    expect(canPickDraftMember(draft, "a", "lead-b", now, [])).toBe(false);
    expect(canPickDraftMember({ ...draft, phase: "scheduled" }, "a", "one", now - 1, [])).toBe(false);
    expect(canPickDraftMember({ ...draft, phase: "scheduled" }, "a", "one", now, [])).toBe(true);
    expect(canPickDraftMember({ ...draft, rosterValid: false }, "a", "one", now, [])).toBe(false);
    expect(canPickDraftMember({ ...draft, actor: { ...draft.actor, canWrite: false } }, "a", "one", now, [])).toBe(false);
  });
  it("rejects stale, revoked, wrong-workspace and published draft responses", () => {
    const { draft, live } = draftFixture();
    const key = draftWorkspaceKey(live)!;
    expect(acceptsDraftSnapshot(draft, live, key)).toBe(true);
    expect(acceptsDraftSnapshot({ ...draft, version: draft.version - 1 }, live, key)).toBe(false);
    expect(acceptsDraftSnapshot({ ...draft, id: "old" }, live, key)).toBe(false);
    expect(acceptsDraftSnapshot({ ...draft, phase: "published" }, live, key)).toBe(false);
    expect(acceptsDraftSnapshot(draft, { ...live, actor: undefined }, key)).toBe(false);
    expect(draftWorkspaceKey({ ...live, board: { ...live.board!, allianceId: "other" } })).toBeNull();
    expect(draftWorkspaceKey({ ...live, board: { ...live.board!, construction: null } })).toBeNull();
  });
  it("uses real board fields and versions for every affordance", () => {
    const snapshot = fixture();
    const command = moveCommand(snapshot, "one", "a");
    expect(command).toEqual({ kind: "move", memberId: "one", from: null, to: "a", expectedVersion: 2 });
    expect(commandEligibility(snapshot, command)).toBeNull();
    expect(commandEligibility(snapshot, { ...command, expectedVersion: 1 })).toBe("changed");
    expect(commandEligibility({ ...snapshot, board: undefined, actor: undefined }, command)).toBe("forbidden");
  });
  it.each([false, true])("blocks maintenance for unpublished/construction boards (%s)", (construction) => {
    const snapshot = fixture();
    snapshot.board = { ...snapshot.board!, published: construction, construction: construction ? { kind: "draft", id: "draft" } : null };
    expect(commandEligibility(snapshot, moveCommand(snapshot, "one", "a"))).toBe("changed");
  });
  it("does not invent authority for other officers' teams or lead cards", () => {
    const snapshot = fixture();
    snapshot.actor = { ...snapshot.actor!, override: false };
    expect(commandEligibility(snapshot, moveCommand(snapshot, "one", "a"))).toBeNull();
    expect(commandEligibility(snapshot, moveCommand(snapshot, "one", "b"))).toBe("forbidden");
    expect(commandEligibility(snapshot, moveCommand(snapshot, "lead-a", null))).toBe("leadRequired");
  });
  it("retains the highest confirmed board during out-of-order fetches", () => {
    const current = fixture();
    expect(acceptSnapshot(current, { ...current, version: 1 })).toBe(current);
    expect(acceptSnapshot(current, { ...current, version: 3 }).version).toBe(3);
    expect(acceptSnapshot(current, { ...current, board: { ...current.board!, allianceId: "other" }, version: 99 })).toBe(current);
  });
  it("locates across every team independently from personal filters", () => {
    const snapshot = fixture();
    expect(locationOf(snapshot, "lead-b")).toBe("b");
    expect(locationOf(snapshot, "one")).toBeNull();
    expect(ownTeamId(snapshot)).toBe("a");
    expect(ownTeamId({ ...snapshot, linkedMemberIds: [] })).toBeNull();
    expect(ownTeamId({ ...snapshot, linkedMemberIds: ["one"] })).toBeNull();
  });
  it("never treats unknown metrics as zero or THP as base power", () => {
    const row = member("one");
    expect(row.thp).not.toBe(row.basePower);
    expect(matchesUnsortedFilters(row, { baseLevel: { min: 30, unknown: "exclude" } })).toBe(false);
    expect(matchesUnsortedFilters(row, { baseLevel: { min: 30, unknown: "include" } })).toBe(true);
    expect(matchesUnsortedFilters(row, { thp: { min: 1000 } })).toBe(false);
    expect(defaultDisplayPreferences).toEqual({ professionLevel: false, baseLevel: false, thp: true, tenureDays: false });
  });
  it("validates country flags with locale-correct accessible names", () => {
    expect(countryPresentation("br", "pt-BR", "Desconhecido").label).toBe("Brasil");
    expect(countryPresentation("US", "pt-BR", "Desconhecido").label).toBe("Estados Unidos");
    expect(countryPresentation("XX", "en-US", "Unknown")).toEqual({ flag: "—", label: "Unknown" });
    expect(countryPresentation(null, "en-US", "Unknown").label).toBe("Unknown");
  });
  it.each([[100, 10, false, false, -1], [-100, 10, false, false, 1], [20, 1, false, false, 0], [100, 80, false, false, 0], [100, 0, true, false, 0], [100, 0, false, true, 0]] as const)("isolates horizontal swipe %s/%s", (dx, dy, interactive, selected, result) => {
    expect(swipeDirection(dx, dy, interactive, selected)).toBe(result);
  });
  it("maps stale/permission failures to approved localized keys", () => {
    expect(supportErrorKey("forbidden")).toBe("readOnly");
    expect(supportErrorKey("changed", true)).toBe("history.changed");
    expect(supportErrorKey("dependencies", true)).toBe("history.dependencies");
    expect(supportErrorKey("unrecognized")).toBe("changed");
  });
  it("parses server failures without displaying raw server copy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "teamFull", error: "private implementation" }), { status: 409 })));
    await expect(supportRequest("/api/support-teams")).rejects.toMatchObject({ code: "teamFull", status: 409 });
  });
  it("does not trust inverse client patches in undo confirmation", () => {
    const preview = { rootActionId: "root", actionIds: ["child", "root"], expectedVersions: { resource: 7 }, patches: [{ key: "resource", before: null, after: "client value", beforeVersion: 1, afterVersion: 2 }] };
    expect(undoConfirmation(preview, "attempt")).toEqual({ actionIds: ["child", "root"], expectedVersions: { resource: 7 }, idempotencyKey: "attempt" });
  });
  it("labels every draft history kind and identifies service actors without impersonating a human", () => {
    expect(Object.keys(historyKindLabels)).toEqual(expect.arrayContaining(["scheduleDraft", "draftPick", "advanceDraft", "extendDraft", "publishDraft", "cancelDraft", "reconcile"]));
    const snapshot = fixture();
    const event = applyCommand(snapshot.board!, snapshot.roster, snapshot.actor!, { kind: "rename", teamId: "a", name: "Cedar", expectedVersion: snapshot.version }, { id: "rename", at: "2026-01-01T00:00:00Z", idempotencyKey: "rename" }).event;
    expect(historyServiceLabel(event)).toBeNull();
    expect(historyServiceLabel({ ...event, kind: "advanceDraft", context: { mode: "draft" }, principalType: "service", principalId: "service:support-team-draft", actorName: "Human-looking name" })).toBe("supportTeams.draft.title");
    expect(historyServiceLabel({ ...event, kind: "reconcile", actorType: "service", principalId: "service:support-team-membership" })).toBe("supportTeams.title");
    expect(historyServiceLabel({ ...event, principalId: "service:unknown" })).toBe("supportTeams.title");
  });
  it("humanizes field references and never falls back to internal IDs", () => {
    const snapshot = fixture();
    const event: Pick<SupportEvent, "memberNames" | "teamNames"> = { memberNames: { one: "Historical name" }, teamNames: { a: "Historical team" } };
    const names = historyNames(snapshot, event, (number) => `Team ${number}`, "Unknown", "Unsorted");
    const labels = { teamName: "Team name", lead: "Lead", member: "Member", unknown: "Unknown", yes: "Yes", no: "No" };
    const patch = { key: fieldKey("member", "one", "team"), before: "a", after: "b", beforeVersion: 1, afterVersion: 2 };
    expect(humanizePatch(patch, names, labels, "en-US")).toEqual({ label: "Historical name", before: "Historical team", after: "Bravo" });
    expect(humanizePatch({ ...patch, key: fieldKey("member", "private-id", "team"), after: "private-team" }, names, labels, "en-US")).toEqual({ label: "Unknown", before: "Historical team", after: "Unknown" });
  });
});
