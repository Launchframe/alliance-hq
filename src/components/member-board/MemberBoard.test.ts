import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemberBoard, type MemberBoardProps } from "./MemberBoard";
import { decodeMemberDrag, dropBoardMember, encodeMemberDrag, focusBoardMember, memberLocation, swipeDirection } from "@/lib/member-board/board.shared";

const members = [{ id: "a", name: "Ada", searchTerms: ["Architect"] }, { id: "b", name: "Bea", searchTerms: ["Builder"] }];
const groups = [{ id: "workshop", name: "Workshop", memberIds: ["a"] }, { id: "studio", name: "Studio", memberIds: [], target: 12 }];
const labels: MemberBoardProps["labels"] = {
  pool: "Available", search: "Search people", findMember: "Locate person", noMatches: "No matches", memberUnavailable: "Unavailable",
  addMember: "Assign", moveMember: "Reassign", removeMember: "Unassign", emptyPool: "Nobody available", emptyGroup: "Nobody assigned",
  groupName: "Workspace", preferredGroup: "My workspace", noGroup: "No workspace", openPool: "Browse people", closePool: "Close people",
  back: "Previous", next: "Next", swipeHint: "Swipe workspaces",
};
function board(scope: string) {
  return createElement(MemberBoard, {
    data: { scope, members, groups }, locale: "pt-BR", labels,
    interactions: { eligibility: () => null, onMove: vi.fn() },
    renderers: {
      member: (member) => createElement("strong", { "data-neutral-person": member.id }, member.name),
      groupHeader: (group) => createElement("h2", null, `Area: ${group.name}`),
      groupActions: (group) => createElement("span", null, `Tools: ${group.id}`),
      groupMessage: (group) => createElement("em", null, `Status: ${group.id}`),
      filters: createElement("span", null, "Skill filters"),
    },
  });
}

describe("neutral member organizer", () => {
  it("renders real reusable pool/grid/search with custom labels, non-ranked groups, renderers and optional targets", () => {
    const html = renderToStaticMarkup(board("organizer:alpha"));
    expect(html).toContain('data-member-board-group="workshop"');
    expect(html).toContain('data-member-board-pool="true"');
    expect(html).toContain('data-neutral-person="b"');
    expect(html).toContain("Area: Workshop");
    expect(html).toContain("Tools: studio");
    expect(html).toContain("Skill filters");
    expect(html).toContain("Status: workshop");
    expect(html).toContain('aria-label="Locate person"');
    expect(html).not.toMatch(/support|R4|leadId|Takedown/i);
    expect(memberLocation(groups, "a")).toBe("workshop");
    expect(memberLocation(groups, "b")).toBeNull();
  });

  it("rejects foreign organizer/workspace/instance payloads even with the same roster", () => {
    const html = renderToStaticMarkup(createElement("main", null, board("same-workspace"), board("same-workspace")));
    const scopes = [...html.matchAll(/data-member-board-scope="([^"]+)"/g)].map((match) => match[1]);
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).not.toBe(scopes[1]);
    const source = { workspace: "same-workspace", instance: scopes[0] };
    const target = { workspace: "same-workspace", instance: scopes[1] };
    const payload = encodeMemberDrag(source, "a");
    expect(decodeMemberDrag(payload, source, members)).toBe("a");
    expect(decodeMemberDrag(payload, target, members)).toBeNull();
    expect(decodeMemberDrag(payload, { ...source, workspace: "other" }, members)).toBeNull();
    expect(decodeMemberDrag(payload, source, [])).toBeNull();
    expect(decodeMemberDrag("a", source, members)).toBeNull();
    expect(decodeMemberDrag('{"memberId":"a"}', source, members)).toBeNull();
    const actions = { eligibility: () => null, onMove: vi.fn() };
    const data = { scope: source.workspace, groups, members };
    expect(dropBoardMember(payload, target, data, actions, "studio", false)).toBe(false);
    expect(actions.onMove).not.toHaveBeenCalled();
    expect(dropBoardMember(payload, source, data, actions, "studio", true)).toBe(false);
    expect(dropBoardMember(payload, source, data, { ...actions, eligibility: () => "locked" }, "studio", false)).toBe(false);
    expect(dropBoardMember(payload, source, data, actions, "absent", false)).toBe(false);
    expect(dropBoardMember(payload, source, data, actions, "studio", false)).toBe(true);
    expect(actions.onMove).toHaveBeenCalledExactlyOnceWith("a", "studio");
  });

  it("focuses only a visible member within the owning root without changing assignments", () => {
    const first = { dataset: { memberBoardMember: "a" }, getClientRects: () => [1], scrollIntoView: vi.fn(), focus: vi.fn() };
    const hidden = { ...first, getClientRects: () => [], focus: vi.fn() };
    const other = { ...first, focus: vi.fn() };
    const root = { querySelector: vi.fn(() => null), querySelectorAll: vi.fn(() => [hidden, first]) };
    focusBoardMember(root as unknown as HTMLElement, "a");
    expect(first.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    const otherRoot = { querySelector: () => null, querySelectorAll: () => [other] };
    focusBoardMember(otherRoot as unknown as HTMLElement, "a");
    expect(other.focus).toHaveBeenCalledTimes(1);
    expect(first.focus).toHaveBeenCalledTimes(1);
    const drawerMember = { ...first, focus: vi.fn() };
    const withDrawer = { querySelector: () => ({ querySelectorAll: () => [drawerMember] }), querySelectorAll: () => [first] };
    focusBoardMember(withDrawer as unknown as HTMLElement, "a");
    expect(drawerMember.focus).toHaveBeenCalledTimes(1);
    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(groups[0].memberIds).toEqual(["a"]);
    expect(swipeDirection(-90, 10, false, false)).toBe(1);
    expect(swipeDirection(-90, 10, true, false)).toBe(0);
    expect(swipeDirection(-90, 10, false, true)).toBe(0);
  });
});
