"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  followMeObserverRootMargin,
  followMeViewportCenterY,
  pickRowClosestToViewportCenter,
} from "@/lib/video/follow-me-row";
import { createFollowAnchorRegistry } from "@/lib/video/follow-me-anchor-registry";
import type { PreviewPlacement } from "@/lib/video/preview-layout";

type Row = { id: string };

type Options<TRow extends Row> = {
  enabled: boolean;
  rows: readonly TRow[];
  canPreview: (row: TRow) => boolean;
  onSeek: (row: TRow) => void;
  previewOpen: boolean;
  previewPlacement: PreviewPlacement;
  dockHeightPx: number;
};

function isElementVisibleInBand(
  rect: DOMRect,
  topInset: number,
  bottomInset: number,
  viewportHeight: number,
): boolean {
  const bandTop = topInset;
  const bandBottom = viewportHeight - bottomInset;
  return rect.bottom > bandTop && rect.top < bandBottom;
}

function parseRootMarginInsets(rootMargin: string): {
  top: number;
  bottom: number;
} {
  const parts = rootMargin.trim().split(/\s+/);
  const top = Math.abs(parseFloat(parts[0] ?? "0")) || 0;
  const bottom = Math.abs(parseFloat(parts[2] ?? "0")) || 0;
  return { top, bottom };
}

export function useVideoReviewFollowMe<TRow extends Row>({
  enabled,
  rows,
  canPreview,
  onSeek,
  previewOpen,
  previewPlacement,
  dockHeightPx,
}: Options<TRow>) {
  const lastSeekedRowIdRef = useRef<string | null>(null);
  const canPreviewRef = useRef(canPreview);
  const onSeekRef = useRef(onSeek);
  const [anchorRevision, setAnchorRevision] = useState(0);

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
    canPreviewRef.current = canPreview;
    onSeekRef.current = onSeek;
  }, [canPreview, onSeek]);

  const registerFollowAnchor = useCallback(
    (rowId: string) => registry.register(rowId),
    [registry],
  );

  useEffect(() => {
    if (!enabled) {
      lastSeekedRowIdRef.current = null;
      return;
    }

    const anchorElements = registry.elements;
    const rootMargin = followMeObserverRootMargin({
      previewOpen,
      placement: previewPlacement,
      dockHeightPx,
    });
    const { top: topInset, bottom: bottomInset } =
      parseRootMarginInsets(rootMargin);
    const rowsById = new Map(rows.map((row) => [row.id, row]));

    const seekRow = (rowId: string) => {
      if (lastSeekedRowIdRef.current === rowId) return;
      const row = rowsById.get(rowId);
      if (row && canPreviewRef.current(row)) {
        lastSeekedRowIdRef.current = rowId;
        onSeekRef.current(row);
      }
    };

    // Track the row nearest the visible band's center — the row the reviewer is
    // looking at — independent of scroll direction. This is what keeps the
    // preview frame aligned with the on-screen roster in both directions.
    const syncToViewportCenter = () => {
      const centerY = followMeViewportCenterY({
        viewportHeight: window.innerHeight,
        previewOpen,
        placement: previewPlacement,
        dockHeightPx,
      });
      const candidates: Array<{ rowId: string; distanceFromCenterPx: number }> =
        [];

      for (const [rowId, element] of anchorElements) {
        const rect = element.getBoundingClientRect();
        if (
          !isElementVisibleInBand(
            rect,
            topInset,
            bottomInset,
            window.innerHeight,
          )
        ) {
          continue;
        }
        const center = rect.top + rect.height / 2;
        candidates.push({
          rowId,
          distanceFromCenterPx: Math.abs(center - centerY),
        });
      }

      const picked = pickRowClosestToViewportCenter(candidates);
      if (picked) seekRow(picked);
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
    window.addEventListener("scroll", onScroll, { passive: true });

    const initialFrame = requestAnimationFrame(syncToViewportCenter);

    return () => {
      cancelAnimationFrame(initialFrame);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      window.removeEventListener("scroll", onScroll);
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

  return { registerFollowAnchor };
}
