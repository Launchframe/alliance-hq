import { useCallback, useState } from "react";

export function wrapProblemIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}

/** Index of `currentId` in `ids`, or 0 when missing / empty. */
export function issueIndexForId(
  currentId: string | null,
  ids: readonly string[],
): number {
  if (ids.length === 0 || currentId == null) return 0;
  const found = ids.indexOf(currentId);
  return found === -1 ? 0 : found;
}

/** Next/prev problem id, wrapping. `null` when the list is empty. */
export function stepIssueId(
  currentId: string | null,
  ids: readonly string[],
  delta: number,
): string | null {
  if (ids.length === 0) return null;
  const from = issueIndexForId(currentId, ids);
  return ids[wrapProblemIndex(from + delta, ids.length)] ?? null;
}

export function useReviewIssueNav(
  problemRowIds: readonly string[],
  scrollToRow: (rowId: string) => void,
) {
  const [currentId, setCurrentId] = useState<string | null>(null);
  const currentIndex = issueIndexForId(currentId, problemRowIds);

  const jumpTo = useCallback(
    (nextIndex: number) => {
      if (problemRowIds.length === 0) return;
      const id = problemRowIds[wrapProblemIndex(nextIndex, problemRowIds.length)];
      if (!id) return;
      setCurrentId(id);
      scrollToRow(id);
    },
    [problemRowIds, scrollToRow],
  );

  const goToNext = useCallback(() => {
    const id = stepIssueId(currentId, problemRowIds, 1);
    if (!id) return;
    setCurrentId(id);
    scrollToRow(id);
  }, [currentId, problemRowIds, scrollToRow]);

  const goToPrev = useCallback(() => {
    const id = stepIssueId(currentId, problemRowIds, -1);
    if (!id) return;
    setCurrentId(id);
    scrollToRow(id);
  }, [currentId, problemRowIds, scrollToRow]);

  return {
    currentIndex,
    goToNext,
    goToPrev,
    jumpTo,
  };
}
