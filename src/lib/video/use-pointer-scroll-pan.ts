"use client";

import { useCallback, useRef, type RefObject } from "react";

const DRAG_THRESHOLD_PX = 6;

/**
 * Pointer drag-to-pan for a vertically scrollable preview container.
 * Defers pointer capture until the user moves past a small threshold so taps
 * and native video controls still work.
 */
export function usePointerScrollPan(
  scrollRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const dragState = useRef<{
    pointerId: number;
    startY: number;
    startScrollTop: number;
    dragging: boolean;
  } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      const el = scrollRef.current;
      if (!el) return;
      dragState.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startScrollTop: el.scrollTop,
        dragging: false,
      };
    },
    [enabled, scrollRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = dragState.current;
      if (!enabled || !state || state.pointerId !== event.pointerId) return;
      const el = scrollRef.current;
      if (!el) return;

      const dy = event.clientY - state.startY;
      if (!state.dragging) {
        if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        state.dragging = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      event.preventDefault();
      el.scrollTop = state.startScrollTop - dy;
    },
    [enabled, scrollRef],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.dragging && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragState.current = null;
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      endDrag(event);
    },
    [endDrag],
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      endDrag(event);
    },
    [endDrag],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
