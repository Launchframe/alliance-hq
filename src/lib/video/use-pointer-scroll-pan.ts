"use client";

import { useCallback, useRef, type RefObject } from "react";

import { computePointerScrollTop } from "@/lib/video/pointer-scroll-pan-logic";

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

      const next = computePointerScrollTop(
        state.startScrollTop,
        state.startY,
        event.clientY,
        state.dragging,
      );
      if (!next) return;
      if (!state.dragging) {
        state.dragging = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      event.preventDefault();
      el.scrollTop = next.scrollTop;
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
