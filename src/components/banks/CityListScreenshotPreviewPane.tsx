"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  GripHorizontal,
  PanelBottom,
  PanelRight,
  PanelTop,
  RotateCcw,
  X,
} from "lucide-react";

import type {
  PreviewImageTransform,
  PreviewPlacement,
} from "@/lib/video/preview-layout";
import {
  clampDockHeightPx,
  clampPreviewImageTransform,
  clampSideWidthPx,
  DEFAULT_PREVIEW_IMAGE_TRANSFORM,
} from "@/lib/video/preview-layout";
import type { CityListImportScreenshotPreview } from "@/lib/banks/city-list-import-session.client";

/** Header offset reserved so sticky panes sit just below the app header. */
const HEADER_OFFSET = "3.25rem";

type Props = {
  screenshots: CityListImportScreenshotPreview[];
  screenshotIndex: number;
  onScreenshotIndexChange: (index: number) => void;
  placement: PreviewPlacement;
  available: PreviewPlacement[];
  onPlacementChange: (placement: PreviewPlacement) => void;
  onClose: () => void;
  sideWidthPx: number;
  dockHeightPx: number;
  onSideWidthChange: (width: number) => void;
  onDockHeightChange: (height: number) => void;
  imageTransform: PreviewImageTransform;
  onImageTransformChange: (transform: PreviewImageTransform) => void;
};

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const PLACEMENT_ICON: Record<
  PreviewPlacement,
  typeof PanelRight
> = {
  side: PanelRight,
  top: PanelTop,
  bottom: PanelBottom,
};

export function CityListScreenshotPreviewPane({
  screenshots,
  screenshotIndex,
  onScreenshotIndexChange,
  placement,
  available,
  onPlacementChange,
  onClose,
  sideWidthPx,
  dockHeightPx,
  onSideWidthChange,
  onDockHeightChange,
  imageTransform,
  onImageTransformChange,
}: Props) {
  const tPreview = useTranslations("videoReview");
  const t = useTranslations("bankManagement");

  const sideResizeRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const dockResizeRef = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );
  const [draftSideWidth, setDraftSideWidth] = useState<number | null>(null);
  const [draftDockHeight, setDraftDockHeight] = useState<number | null>(null);
  const draftSideWidthRef = useRef<number | null>(null);
  const draftDockHeightRef = useRef<number | null>(null);

  const activeShot = screenshots[screenshotIndex] ?? screenshots[0];
  const hasMultiple = screenshots.length > 1;

  const containerClass = cn(
    "z-20 flex max-w-full flex-col overflow-x-clip bg-black",
    placement === "side" &&
      "sticky shrink-0 self-start border-l border-hq-border",
    placement === "top" &&
      "sticky w-full max-w-full border-b border-hq-border",
    placement === "bottom" &&
      "fixed bottom-0 left-0 right-0 z-30 w-full max-w-full border-t border-hq-border",
  );

  const displaySideWidth = draftSideWidth ?? sideWidthPx;
  const displayDockHeight = draftDockHeight ?? dockHeightPx;

  const containerStyle =
    placement === "side"
      ? {
          top: HEADER_OFFSET,
          height: `calc(100dvh - ${HEADER_OFFSET})`,
          width: displaySideWidth,
        }
      : placement === "top"
        ? { top: HEADER_OFFSET, height: displayDockHeight }
        : { height: displayDockHeight };

  const goPrev = () => {
    if (!hasMultiple) return;
    onScreenshotIndexChange(
      (screenshotIndex - 1 + screenshots.length) % screenshots.length,
    );
  };

  const goNext = () => {
    if (!hasMultiple) return;
    onScreenshotIndexChange((screenshotIndex + 1) % screenshots.length);
  };

  const onSideResizePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    sideResizeRef.current = {
      startX: event.clientX,
      startWidth: sideWidthPx,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onSideResizePointerMove = (event: React.PointerEvent) => {
    const state = sideResizeRef.current;
    if (!state) return;
    const delta = state.startX - event.clientX;
    const nextWidth = clampSideWidthPx(
      state.startWidth + delta,
      window.innerWidth,
    );
    draftSideWidthRef.current = nextWidth;
    setDraftSideWidth(nextWidth);
  };

  const onSideResizePointerUp = (event: React.PointerEvent) => {
    if (
      sideResizeRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (draftSideWidthRef.current != null) {
      onSideWidthChange(draftSideWidthRef.current);
      draftSideWidthRef.current = null;
    }
    setDraftSideWidth(null);
    sideResizeRef.current = null;
  };

  const onDockResizePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dockResizeRef.current = {
      startY: event.clientY,
      startHeight: dockHeightPx,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onDockResizePointerMove = (event: React.PointerEvent) => {
    const state = dockResizeRef.current;
    if (!state) return;
    const delta =
      placement === "bottom"
        ? state.startY - event.clientY
        : event.clientY - state.startY;
    const nextHeight = clampDockHeightPx(
      state.startHeight + delta,
      window.innerHeight,
    );
    draftDockHeightRef.current = nextHeight;
    setDraftDockHeight(nextHeight);
  };

  const onDockResizePointerUp = (event: React.PointerEvent) => {
    if (
      dockResizeRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (draftDockHeightRef.current != null) {
      onDockHeightChange(draftDockHeightRef.current);
      draftDockHeightRef.current = null;
    }
    setDraftDockHeight(null);
    dockResizeRef.current = null;
  };

  const resetTransform = () => {
    onImageTransformChange(DEFAULT_PREVIEW_IMAGE_TRANSFORM);
  };

  if (!activeShot) return null;

  return (
    <div className={containerClass} style={containerStyle}>
      {placement === "side" ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={tPreview("previewResizeWidth")}
          className="absolute bottom-0 left-0 top-0 z-10 w-2 cursor-col-resize touch-none hover:bg-hq-accent/25"
          onPointerDown={onSideResizePointerDown}
          onPointerMove={onSideResizePointerMove}
          onPointerUp={onSideResizePointerUp}
          onPointerCancel={onSideResizePointerUp}
        />
      ) : null}
      {placement === "top" || placement === "bottom" ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={tPreview("previewResizeHeight")}
          className={cn(
            "absolute left-1/2 z-10 flex h-4 w-14 -translate-x-1/2 cursor-row-resize touch-none items-center justify-center rounded-full bg-hq-surface-muted text-hq-fg-muted hover:bg-hq-border hover:text-hq-fg",
            placement === "bottom" ? "-top-2" : "-bottom-2",
          )}
          onPointerDown={onDockResizePointerDown}
          onPointerMove={onDockResizePointerMove}
          onPointerUp={onDockResizePointerUp}
          onPointerCancel={onDockResizePointerUp}
        >
          <GripHorizontal className="h-3.5 w-3.5" aria-hidden />
        </div>
      ) : null}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hq-border bg-hq-surface px-3 py-2">
        <span className="truncate text-sm font-medium text-hq-fg">
          {t("cityListPreviewScreenshots")}
          {hasMultiple
            ? ` (${screenshotIndex + 1}/${screenshots.length})`
            : null}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasMultiple ? (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={goPrev}
                aria-label={t("cityListPreviousScreenshot")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label={t("cityListNextScreenshot")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={resetTransform}
            aria-label={t("cityListResetPreviewZoom")}
            title={t("cityListResetPreviewZoom")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
          {available.length > 1 ? (
            <div
              role="group"
              aria-label={tPreview("previewPlacementLabel")}
              className="flex items-center gap-0.5 rounded-lg border border-hq-border p-0.5"
            >
              {available.map((option) => {
                const Icon = PLACEMENT_ICON[option];
                const active = option === placement;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onPlacementChange(option)}
                    aria-pressed={active}
                    title={tPreview(`previewPlacement.${option}`)}
                    aria-label={tPreview(`previewPlacement.${option}`)}
                    className={cn(
                      "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                      active
                        ? "bg-hq-border text-hq-fg"
                        : "text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </button>
                );
              })}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cityListClosePreview")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      {hasMultiple ? (
        <ul className="flex shrink-0 gap-1 overflow-x-auto border-b border-hq-border bg-hq-surface px-2 py-1.5">
          {screenshots.map((shot, index) => (
            <li key={shot.id} className="shrink-0">
              <button
                type="button"
                className={
                  index === screenshotIndex
                    ? "overflow-hidden rounded border-2 border-hq-accent"
                    : "overflow-hidden rounded border border-hq-border"
                }
                onClick={() => onScreenshotIndexChange(index)}
                aria-label={t("cityListThumbnailPreview")}
                aria-current={index === screenshotIndex ? "true" : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.previewUrl}
                  alt=""
                  className="h-12 w-9 object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ZoomableScreenshotBody
        key={activeShot.id}
        src={activeShot.previewUrl}
        alt={t("cityListThumbnailPreview")}
        panHintLabel={tPreview("previewPanHint")}
        transform={imageTransform}
        onTransformChange={onImageTransformChange}
      />
    </div>
  );
}

function ZoomableScreenshotBody({
  src,
  alt,
  panHintLabel,
  transform,
  onTransformChange,
}: {
  src: string;
  alt: string;
  panHintLabel: string;
  transform: PreviewImageTransform;
  onTransformChange: (transform: PreviewImageTransform) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragging: boolean;
  } | null>(null);
  const transformRef = useRef(transform);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const persistTransform = useCallback(
    (next: PreviewImageTransform) => {
      onTransformChange(clampPreviewImageTransform(next));
    },
    [onTransformChange],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const cursorX = event.clientX - rect.left - rect.width / 2;
      const cursorY = event.clientY - rect.top - rect.height / 2;
      const current = transformRef.current;
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nextScale = Math.min(6, Math.max(1, current.scale * factor));
      const scaleRatio = nextScale / current.scale;
      persistTransform({
        scale: nextScale,
        x: current.x - cursorX * (scaleRatio - 1),
        y: current.y - cursorY * (scaleRatio - 1),
      });
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [persistTransform]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const current = transformRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
      dragging: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.dragging && Math.hypot(dx, dy) < 4) return;
    if (!state.dragging) {
      state.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    persistTransform({
      ...transformRef.current,
      x: state.originX + dx,
      y: state.originY + dy,
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.dragging && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const showPanHint = transform.scale > 1;

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 flex-1 touch-none overflow-hidden bg-black"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {showPanHint ? (
        <p className="pointer-events-none absolute left-0 right-0 top-1 z-[1] px-2 text-center text-[10px] text-hq-fg-muted/90">
          {panHintLabel}
        </p>
      ) : null}
      <div className="flex h-full w-full items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: "center center",
          }}
        />
      </div>
    </div>
  );
}
