import { useCallback, useEffect, useState } from "react";

export function useReviewIssueNav(
  problemRowIds: readonly string[],
  scrollToRow: (rowId: string) => void,
) {
  const [index, setIndex] = useState(0);
  const problemRowIdsKey = problemRowIds.join(",");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setIndex(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [problemRowIdsKey]);

  const jumpTo = useCallback(
    (nextIndex: number) => {
      if (problemRowIds.length === 0) return;
      const wrapped =
        ((nextIndex % problemRowIds.length) + problemRowIds.length) %
        problemRowIds.length;
      setIndex(wrapped);
      scrollToRow(problemRowIds[wrapped]!);
    },
    [problemRowIds, scrollToRow],
  );

  return {
    currentIndex: index,
    goToNext: () => jumpTo(index + 1),
    goToPrev: () => jumpTo(index - 1),
    jumpTo,
  };
}
