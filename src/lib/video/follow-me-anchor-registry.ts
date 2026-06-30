/**
 * Tracks the DOM elements of Follow-me row anchors and hands out a *stable*
 * callback-ref per row id.
 *
 * Why stability matters: React re-invokes a callback ref (old ref with `null`,
 * new ref with the node) on every commit where the ref's function identity
 * changes. If the per-row ref were created inline (`registerFollowAnchor(id)`
 * returning a fresh closure each render) and that closure called `setState`,
 * every commit would detach + reattach the anchor → `setState` → re-render →
 * new closures → … i.e. an infinite render loop (React error #185,
 * "Maximum update depth exceeded"). Returning the same callback instance for a
 * given row id lets React skip the detach/reattach, so `onChange` fires only on
 * a genuine mount/unmount.
 */
export type FollowAnchorRegistry<E> = {
  /** Live map of row id → currently-mounted anchor element. */
  readonly elements: Map<string, E>;
  /** Stable callback ref for a row id (same instance across calls). */
  register: (rowId: string) => (element: E | null) => void;
};

export function createFollowAnchorRegistry<E>(options: {
  /** Invoked only when an anchor actually mounts, unmounts, or swaps nodes. */
  onChange: () => void;
}): FollowAnchorRegistry<E> {
  const elements = new Map<string, E>();
  const callbacks = new Map<string, (element: E | null) => void>();

  function register(rowId: string): (element: E | null) => void {
    const existing = callbacks.get(rowId);
    if (existing) return existing;

    const callback = (element: E | null) => {
      if (element) {
        if (elements.get(rowId) !== element) {
          elements.set(rowId, element);
          options.onChange();
        }
      } else if (elements.delete(rowId)) {
        options.onChange();
      }
    };
    callbacks.set(rowId, callback);
    return callback;
  }

  return { elements, register };
}
