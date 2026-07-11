"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  GripHorizontal,
  PanelBottom,
  PanelRight,
  PanelTop,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type {
  PreviewPlacement,
  PreviewZoom,
} from "@/lib/video/preview-layout";
import {
  clampDockHeightPx,
  clampSideWidthPx,
} from "@/lib/video/preview-layout";
import { previewWheelSeekSeconds } from "@/lib/video/frame-video-seek";
import { usePointerScrollPan } from "@/lib/video/use-pointer-scroll-pan";

export type VideoSeekRequest = { seconds: number; nonce: number } | null;

/**
 * Imperative scrub channel for follow-me. Seeking through React state would
 * re-render the whole review tree on every scroll frame; the controller sets
 * `currentTime` directly so continuous scrubbing stays cheap.
 */
export type VideoSeekController = { seek: (seconds: number) => void };

/** Header offset reserved so sticky panes sit just below the app header. */
const HEADER_OFFSET = "3.25rem";
/** Default height of top/bottom docks when no persisted size exists. */
export const PREVIEW_DOCK_HEIGHT = "42dvh";

type Props = {
  jobId: string;
  placement: PreviewPlacement;
  available: PreviewPlacement[];
  onPlacementChange: (placement: PreviewPlacement) => void;
  zoom: PreviewZoom;
  onZoomChange: (zoom: PreviewZoom) => void;
  onClose: () => void;
  unavailable?: boolean;
  seekRequest?: VideoSeekRequest;
  seekControllerRef?: React.Ref<VideoSeekController | null>;
  sideWidthPx: number;
  dockHeightPx: number;
  onSideWidthChange: (width: number) => void;
  onDockHeightChange: (height: number) => void;
};

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function ReviewVideoPreview({
  jobId,
  placement,
  available,
  onPlacementChange,
  zoom,
  onZoomChange,
  onClose,
  unavailable = false,
  seekRequest = null,
  seekControllerRef,
  sideWidthPx,
  dockHeightPx,
  onSideWidthChange,
  onDockHeightChange,
}: Props) {
  const t = useTranslations("videoReview");
  const videoRef = useRef<HTMLVideoElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
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

  const zoomable = placement !== "side";
  const effectiveZoom: PreviewZoom = zoomable ? zoom : "fit";

  useImperativeHandle(
    seekControllerRef,
    () => ({
      seek: (seconds: number) => {
        const el = videoRef.current;
        if (!el || !Number.isFinite(seconds)) return;
        try {
          el.pause();
          el.currentTime = Math.max(0, seconds);
        } catch {
          // ignore seek failures (e.g. unbuffered range)
        }
      },
    }),
    [],
  );

  useEffect(() => {
    if (!seekRequest) return;
    const el = videoRef.current;
    if (!el) return;

    const seekTo = seekRequest.seconds;
    const applySeek = () => {
      try {
        el.pause();
        el.currentTime = seekTo;
      } catch {
        // ignore seek failures (e.g. unbuffered range)
      }
    };

    if (el.readyState >= 1) {
      applySeek();
      return;
    }
    el.addEventListener("loadedmetadata", applySeek, { once: true });
    return () => el.removeEventListener("loadedmetadata", applySeek);
  }, [seekRequest]);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container || unavailable || effectiveZoom === "width") return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const el = videoRef.current;
      if (!el) return;
      event.preventDefault();
      try {
        el.pause();
        el.currentTime = previewWheelSeekSeconds(
          el.currentTime,
          event.deltaY,
          el.duration,
        );
      } catch {
        // ignore seek failures (e.g. unbuffered range)
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [unavailable, jobId, effectiveZoom]);

  // sticky (not relative+sticky): sticky already positions absolute resize
  // handles. z-20 keeps the pane under the shell header (z-30) while above
  // scrolling review content.
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
    if (sideResizeRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
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
    if (dockResizeRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (draftDockHeightRef.current != null) {
      onDockHeightChange(draftDockHeightRef.current);
      draftDockHeightRef.current = null;
    }
    setDraftDockHeight(null);
    dockResizeRef.current = null;
  };

  return (
    <div className={containerClass} style={containerStyle}>
      {placement === "side" ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("previewResizeWidth")}
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
          aria-label={t("previewResizeHeight")}
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
      <PanelChrome
        label={t("previewVideo")}
        closeLabel={t("closePreview")}
        placementLabel={t("previewPlacementLabel")}
        placement={placement}
        available={available}
        onPlacementChange={onPlacementChange}
        zoom={effectiveZoom}
        zoomable={zoomable}
        onZoomToggle={() =>
          onZoomChange(effectiveZoom === "width" ? "fit" : "width")
        }
        zoomFillLabel={t("previewZoomFill")}
        zoomFitLabel={t("previewZoomFit")}
        onClose={onClose}
        optionLabel={(p) => t(`previewPlacement.${p}`)}
      />
      <VideoBody
        bodyRef={bodyRef}
        videoRef={videoRef}
        jobId={jobId}
        zoom={effectiveZoom}
        unavailable={unavailable}
        unavailableLabel={t("previewUnavailable")}
        panHintLabel={t("previewPanHint")}
      />
    </div>
  );
}

const PLACEMENT_ICON: Record<
  PreviewPlacement,
  typeof PanelRight
> = {
  side: PanelRight,
  top: PanelTop,
  bottom: PanelBottom,
};

function PanelChrome({
  label,
  closeLabel,
  placementLabel,
  placement,
  available,
  onPlacementChange,
  zoom,
  zoomable,
  onZoomToggle,
  zoomFillLabel,
  zoomFitLabel,
  onClose,
  optionLabel,
}: {
  label: string;
  closeLabel: string;
  placementLabel: string;
  placement: PreviewPlacement;
  available: PreviewPlacement[];
  onPlacementChange: (placement: PreviewPlacement) => void;
  zoom: PreviewZoom;
  zoomable: boolean;
  onZoomToggle: () => void;
  zoomFillLabel: string;
  zoomFitLabel: string;
  onClose: () => void;
  optionLabel: (placement: PreviewPlacement) => string;
}) {
  const filled = zoom === "width";
  const zoomLabel = filled ? zoomFitLabel : zoomFillLabel;
  const ZoomIcon = filled ? ZoomOut : ZoomIn;
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hq-border bg-hq-surface px-3 py-2">
      <span className="truncate text-sm font-medium text-hq-fg">
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        {zoomable ? (
          <button
            type="button"
            onClick={onZoomToggle}
            aria-pressed={filled}
            title={zoomLabel}
            aria-label={zoomLabel}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              filled
                ? "bg-hq-border text-hq-fg"
                : "text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg",
            )}
          >
            <ZoomIcon className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        {available.length > 1 ? (
          <div
            role="group"
            aria-label={placementLabel}
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
                  title={optionLabel(option)}
                  aria-label={optionLabel(option)}
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
          aria-label={closeLabel}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function VideoBody({
  bodyRef,
  videoRef,
  jobId,
  zoom,
  unavailable,
  unavailableLabel,
  panHintLabel,
}: {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  jobId: string;
  zoom: PreviewZoom;
  unavailable: boolean;
  unavailableLabel: string;
  panHintLabel: string;
}) {
  const panEnabled = zoom === "width" && !unavailable;
  const panHandlers = usePointerScrollPan(bodyRef, panEnabled);

  if (unavailable) {
    return (
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <p className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-hq-fg-muted">
          {unavailableLabel}
        </p>
      </div>
    );
  }

  const src = `/api/tools/video-upload/${jobId}/video`;

  if (zoom === "width") {
    return (
      <div
        ref={bodyRef}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y"
        {...panHandlers}
      >
        <p className="pointer-events-none absolute left-0 right-0 top-1 z-[1] px-2 text-center text-[10px] text-hq-fg-muted/90">
          {panHintLabel}
        </p>
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          className="block h-auto w-full max-w-full"
        />
      </div>
    );
  }

  return (
    <div
      ref={bodyRef}
      className="relative min-h-0 flex-1 overflow-x-hidden"
    >
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        className="h-full w-full max-w-full object-contain"
      />
    </div>
  );
}
