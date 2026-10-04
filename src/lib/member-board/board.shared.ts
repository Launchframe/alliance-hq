export type BoardMember = { id: string; name: string; searchTerms?: readonly string[] };
export type BoardGroup = { id: string; name: string; memberIds: readonly string[]; target?: number; optionLabel?: string };
export type MemberBoardData<M extends BoardMember = BoardMember, G extends BoardGroup = BoardGroup> = {
  scope: string;
  members: readonly M[];
  groups: readonly G[];
  preferredGroupId?: string | null;
};
export type MemberBoardInteractions = {
  eligibility: (memberId: string, groupId: string | null) => string | null;
  onMove: (memberId: string, groupId: string | null) => void;
};
export type DragScope = { workspace: string; instance: string };
export const memberDragType = "application/x-member-board-member";
export function encodeMemberDrag(scope: DragScope, memberId: string) {
  return JSON.stringify({ ...scope, memberId });
}
export function decodeMemberDrag(payload: string, scope: DragScope, members: readonly BoardMember[]): string | null {
  try {
    const value = JSON.parse(payload);
    return value && value.workspace === scope.workspace && value.instance === scope.instance && typeof value.memberId === "string" && members.some((member) => member.id === value.memberId) ? value.memberId : null;
  } catch { return null; }
}
export function dropBoardMember(payload: string, scope: DragScope, data: MemberBoardData, interactions: MemberBoardInteractions, to: string | null, pending: boolean): boolean {
  const id = decodeMemberDrag(payload, scope, data.members);
  if (!id || pending || (to !== null && !data.groups.some((group) => group.id === to)) || interactions.eligibility(id, to)) return false;
  interactions.onMove(id, to);
  return true;
}
export function memberLocation(groups: readonly Pick<BoardGroup, "id" | "memberIds">[], memberId: string): string | null {
  return groups.find((group) => group.memberIds.includes(memberId))?.id ?? null;
}
export function focusBoardMember(root: HTMLElement, memberId: string) {
  const surface = root.querySelector<HTMLElement>("dialog[open]") ?? root;
  const target = [...surface.querySelectorAll<HTMLElement>("[data-member-board-member]")].find((element) => element.dataset.memberBoardMember === memberId && element.getClientRects().length > 0);
  target?.scrollIntoView({ block: "nearest", behavior: "instant" });
  target?.focus({ preventScroll: true });
}
export function swipeDirection(dx: number, dy: number, interactive: boolean, selectedText: boolean): -1 | 0 | 1 {
  if (interactive || selectedText || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx < 0 ? 1 : -1;
}
