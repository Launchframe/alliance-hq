"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  followMeObserverRootMargin,
  followMeViewportCenterY,
  interpolateSecondsAtCenter,
  type FollowAnchorSample,
} from "@/lib/video/follow-me-row";
import { createFollowAnchorRegistry } from "@/lib/video/follow-me-anchor-registry";
import type { PreviewPlacement } from "@/lib/video/preview-layout";

type Row = { id: string };

type Options<TRow extends Row> = {
  enabled: boolean;
  rows: readonly TRow[];
  /** Video time (seconds) for a row's frame, or null if it has no frame. */
  secondsForRow: (row: TRow) => number | null;
  /** Seek the preview to an (interpolated) video time. */
  onSeekSeconds: (seconds: number) => void;
  previewOpen: boolean;
  previewPlacement: PreviewPlacement;
  dockHeightPx: number;
};

/** Smaller than a single frame step (~1s) so scrubbing stays smooth without
 * spamming identical currentTime writes. */
const SEEK_EPSILON_SECONDS = 0.02;

export function useVideoReviewFollowMe<TRow extends Row>({
  enabled,
  rows,
  secondsForRow,
  onSeekSeconds,
  previewOpen,
  previewPlacement,
  dockHeightPx,
}: Options<TRow>) {
  const lastSeekedSecondsRef = useRef<number | null>(null);
  const activeFollowMeRowIdRef = useRef<string | null>(null);
  const secondsForRowRef = useRef(secondsForRow);
  const onSeekSecondsRef = useRef(onSeekSeconds);
  const [anchorRevision, setAnchorRevision] = useState(0);
  const [activeFollowMeRowId, setActiveFollowMeRowId] = useState<string | null>(
    null,
  );

  // A single registry per hook instance hands out a *stable* callback ref per
  // row id, so React does not detach/reattach (and thus re-run setState) on
  // every commit. See follow-me-anchor-registry.ts for the React #185 rationale.
  // Created once via a lazy state initializer (never updated) so we never read
  // or write a ref during render.
  const [registry] = useState(() =>
    createFollowAnchorRegistry<HTMLElement>({
      onChange: () => setAnchorRevision((v) => v + 1),
    }),
  );

  useEffect(() => {
    secondsForRowRef.current = secondsForRow;
    onSeekSecondsRef.current = onSeekSeconds;
  }, [secondsForRow, onSeekSeconds]);

  const registerFollowAnchor = useCallback(
    (rowId: string) => registry.register(rowId),
    [registry],
  );

  useEffect(() => {
    if (!enabled) {
      lastSeekedSecondsRef.current = null;
      activeFollowMeRowIdRef.current = null;
      setActiveFollowMeRowId(null);
      return;
    }

    // Force a seek on the first sync after deps change (placement, dock, rows).
    lastSeekedSecondsRef.current = null;

    const anchorElements = registry.elements;
    const rootMargin = followMeObserverRootMargin({
      previewOpen,
      placement: previewPlacement,
      dockHeightPx,
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));

    // Interpolate the preview time from the row anchors bracketing the viewport
    // center, so the video scrubs smoothly as the roster scrolls instead of
    // snapping to the nearest row's discrete frame. Tracking the center (not a
    // scroll-direction leading edge) keeps both scroll directions aligned.
    const syncToViewportCenter = () => {
      const centerY = followMeViewportCenterY({
        viewportHeight: window.innerHeight,
        previewOpen,
        placement: previewPlacement,
        dockHeightPx,
      });

      const samples: FollowAnchorSample[] = [];
      let closestRowId: string | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const [rowId, element] of anchorElements) {
        const row = rowsById.get(rowId);
        if (!row) continue;
        const seconds = secondsForRowRef.current(row);
        if (seconds == null) continue;
        const rect = element.getBoundingClientRect();
        const centerPx = rect.top + rect.height / 2;
        samples.push({ seconds, centerPx });
        const distance = Math.abs(centerPx - centerY);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestRowId = rowId;
        }
      }

      if (closestRowId !== activeFollowMeRowIdRef.current) {
        activeFollowMeRowIdRef.current = closestRowId;
        setActiveFollowMeRowId(closestRowId);
      }

      const seconds = interpolateSecondsAtCenter(samples, centerY);
      if (seconds == null) return;
      const last = lastSeekedSecondsRef.current;
      if (last != null && Math.abs(last - seconds) < SEEK_EPSILON_SECONDS) {
        return;
      }
      lastSeekedSecondsRef.current = seconds;
      onSeekSecondsRef.current(seconds);
    };

    // The observer keeps tracking responsive when rows enter/leave the band
    // (e.g. the table re-renders); continuous tracking during a scroll gesture
    // comes from the rAF-throttled scroll listener below.
    const observer = new IntersectionObserver(
      () => syncToViewportCenter(),
      { root: null, rootMargin, threshold: [0, 0.5, 1] },
    );

    for (const element of anchorElements.values()) {
      observer.observe(element);
    }

    let scrollFrame = 0;
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        syncToViewportCenter();
      });
    };
    // capture: true so nested scrollports (overflow ancestors) still drive
    // follow-me — bubble-only window listeners miss those events.
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll, { passive: true });

    const initialFrame = requestAnimationFrame(syncToViewportCenter);

    return () => {
      cancelAnimationFrame(initialFrame);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      observer.disconnect();
    };
  }, [
    enabled,
    rows,
    previewOpen,
    previewPlacement,
    dockHeightPx,
    anchorRevision,
    registry,
  ]);

  return { registerFollowAnchor, activeFollowMeRowId };
}
