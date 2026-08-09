import { useCallback, useEffect, useState } from "react";

export function wrapProblemIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}

export function useReviewIssueNav(
  problemRowIds: readonly string[],
  scrollToRow: (rowId: string) => void,
) {
  const [index, setIndex] = useState(0);
  const problemRowIdsKey = problemRowIds.join(",");
  const safeIndex = wrapProblemIndex(index, problemRowIds.length);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIndex(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [problemRowIdsKey]);

  const jumpTo = useCallback(
    (nextIndex: number) => {
      if (problemRowIds.length === 0) return;
      const wrapped = wrapProblemIndex(nextIndex, problemRowIds.length);
      setIndex(wrapped);
      scrollToRow(problemRowIds[wrapped]!);
    },
    [problemRowIds, scrollToRow],
  );

  return {
    currentIndex: safeIndex,
    goToNext: () => jumpTo(safeIndex + 1),
    goToPrev: () => jumpTo(safeIndex - 1),
    jumpTo,
  };
}
