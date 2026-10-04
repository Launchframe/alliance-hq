import { expect, it } from "vitest";
import { findSupportMembers, selectedMemberCommand } from "./member-search.shared";
import { emptyBoard, fieldKey } from "./policy.shared";
import type { SupportRosterMember } from "./types.shared";

const members: SupportRosterMember[] = ["Freddy", "Freddie"].map((name, index) => ({ id: `member-${index}`, name, previousNames: index === 0 ? ["Old nickname"] : [], rank: 3, country: null, professionLevel: null, baseLevel: null, basePower: null, kills: null, thp: null, tenureDays: null, hqLinked: false, discordLinked: false }));
it("searches aliases and all swimlanes without inheriting personal Unsorted filters", () => {
  const board = emptyBoard("a");
  board.fields[fieldKey("member", "member-0", "team")] = { value: "team-a", version: 1, actionId: "assignment" };
  const results = findSupportMembers(board, members, "old nick");
  expect(results[0]).toMatchObject({ memberId: "member-0", teamId: "team-a" });
});
it("does not turn a top ambiguous match into an automatic assignment", () => {
  const board = emptyBoard("a");
  expect(findSupportMembers(board, members, "Fredd")).toHaveLength(2);
  expect(selectedMemberCommand(board, members, null, "team-a")).toBeNull();
  expect(selectedMemberCommand(board, members, "member-1", "team-a")).toEqual({ kind: "move", expectedVersion: 0, memberId: "member-1", from: null, to: "team-a" });
});
