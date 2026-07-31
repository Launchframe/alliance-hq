/**
 * Deposit-slip review table keeps a stable row order while an officer edits
 * cells so depositAt sort does not yank rows (and Follow-me anchors) mid-edit.
 */

export function applyFrozenDepositSlipRowOrder<T extends { id: string }>(
  sortedRows: readonly T[],
  frozenRowIds: readonly string[] | null,
): T[] {
  if (!frozenRowIds) return [...sortedRows];
  const byId = new Map(sortedRows.map((row) => [row.id, row]));
  return frozenRowIds
    .map((id) => byId.get(id))
    .filter((row): row is T => row != null);
}

function eventTargetIsContainedIn(
  tbody: HTMLElement,
  target: EventTarget | null,
): boolean {
  if (target == null) return false;
  const node = target as Node;
  if (typeof node.nodeType !== "number") return false;
  try {
    return tbody.contains(node);
  } catch {
    return false;
  }
}

/**
 * Native `datetime-local` pickers move focus outside the table on blur. Defer
 * unfreezing until we know focus did not return to another cell in the tbody.
 */
export function shouldKeepDepositSlipSortFrozenOnTbodyBlur(
  tbody: HTMLElement | null,
  relatedTarget: EventTarget | null,
  activeElement: Element | null,
): boolean {
  if (!tbody) return false;
  if (eventTargetIsContainedIn(tbody, relatedTarget)) {
    return true;
  }
  if (eventTargetIsContainedIn(tbody, activeElement)) {
    return true;
  }
  return false;
}
