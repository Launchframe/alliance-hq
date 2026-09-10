import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptSnapshot, commandEligibility, countryPresentation, locationOf, moveCommand, ownTeamId, supportErrorKey, supportRequest, swipeDirection } from "./board-client.shared";
import { defaultDisplayPreferences, matchesUnsortedFilters } from "./display-preferences.shared";
import { applyCommand, emptyBoard, fieldKey } from "./policy.shared";
import { historyNames, humanizePatch, undoConfirmation } from "./history-client.shared";
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
