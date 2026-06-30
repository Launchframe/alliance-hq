"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildRowOrderIndex,
  followMeObserverRootMargin,
  followMeViewportCenterY,
  pickNewlyEnteredRow,
  pickRowClosestToViewportCenter,
  type FollowMeScrollDirection,
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
  const visibleRowIdsRef = useRef<Set<string>>(new Set());
  const scrollDirectionRef = useRef<FollowMeScrollDirection>("unknown");
  const lastScrollYRef = useRef(0);
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
    if (!enabled) return;
    lastScrollYRef.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastScrollYRef.current + 2) {
        scrollDirectionRef.current = "down";
      } else if (y < lastScrollYRef.current - 2) {
        scrollDirectionRef.current = "up";
      }
      lastScrollYRef.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      visibleRowIdsRef.current = new Set();
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
    const rowOrder = buildRowOrderIndex(rows);
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    visibleRowIdsRef.current = new Set();

    const seekRow = (rowId: string) => {
      if (lastSeekedRowIdRef.current === rowId) return;
      const row = rowsById.get(rowId);
      if (row && canPreviewRef.current(row)) {
        lastSeekedRowIdRef.current = rowId;
        onSeekRef.current(row);
      }
    };

    const syncVisibleAnchors = () => {
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
        visibleRowIdsRef.current.add(rowId);
      }

      const picked = pickRowClosestToViewportCenter(candidates);
      if (picked) seekRow(picked);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const newlyEntered: string[] = [];

        for (const entry of entries) {
          const rowId = entry.target.getAttribute("data-video-follow-anchor");
          if (!rowId) continue;
          const wasVisible = visibleRowIdsRef.current.has(rowId);
          if (entry.isIntersecting) {
            if (!wasVisible) newlyEntered.push(rowId);
            visibleRowIdsRef.current.add(rowId);
          } else {
            visibleRowIdsRef.current.delete(rowId);
          }
        }

        if (newlyEntered.length === 0) return;
        const picked = pickNewlyEnteredRow(
          newlyEntered,
          rowOrder,
          scrollDirectionRef.current,
        );
        if (picked) seekRow(picked);
      },
      { root: null, rootMargin, threshold: 0.5 },
    );

    for (const element of anchorElements.values()) {
      observer.observe(element);
    }

    const frame = requestAnimationFrame(syncVisibleAnchors);

    return () => {
      cancelAnimationFrame(frame);
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
