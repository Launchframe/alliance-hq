"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
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

export type VideoSeekRequest = { seconds: number; nonce: number } | null;

/** Header offset reserved so sticky panes sit just below the app header. */
const HEADER_OFFSET = "3.25rem";
/** Height of the top/bottom docked panes (and matching content padding). */
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
}: Props) {
  const t = useTranslations("videoReview");
  const videoRef = useRef<HTMLVideoElement>(null);

  // Fill-width only helps the short top/bottom docks; the tall side column
  // already constrains a portrait frame by width.
  const zoomable = placement !== "side";
  const effectiveZoom: PreviewZoom = zoomable ? zoom : "fit";

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

  const containerClass = cn(
    "z-30 flex flex-col bg-black",
    // Side dock hugs the right viewport edge: negative right margin cancels the
    // app shell's content padding (main = p-4 / md:p-6) so the pane spans to the
    // edge instead of leaving a padding gap on its right.
    placement === "side" &&
      "sticky w-[min(45vw,26rem)] shrink-0 self-start border-l border-[#30363d] -mr-4 md:-mr-6",
    // Top dock is full-bleed: negative margins cancel the app shell's content
    // padding (main = p-4 / md:p-6) so it spans the full width of the content
    // area and sits flush under the sticky header instead of being inset. The
    // flex parent stretches it to that wider box; no fixed width needed.
    placement === "top" &&
      "sticky -mx-4 -mt-4 border-b border-[#30363d] md:-mx-6 md:-mt-6",
    placement === "bottom" && "fixed inset-x-0 bottom-0 border-t border-[#30363d]",
  );

  const containerStyle =
    placement === "side"
      ? { top: HEADER_OFFSET, height: `calc(100dvh - ${HEADER_OFFSET})` }
      : placement === "top"
        ? { top: HEADER_OFFSET, height: PREVIEW_DOCK_HEIGHT }
        : { height: PREVIEW_DOCK_HEIGHT };

  return (
    <div className={containerClass} style={containerStyle}>
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
        videoRef={videoRef}
        jobId={jobId}
        zoom={effectiveZoom}
        unavailable={unavailable}
        unavailableLabel={t("previewUnavailable")}
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
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#30363d] bg-[#161b22] px-3 py-2">
      <span className="truncate text-sm font-medium text-[#e6edf3]">
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
                ? "bg-[#30363d] text-[#e6edf3]"
                : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]",
            )}
          >
            <ZoomIcon className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        {available.length > 1 ? (
          <div
            role="group"
            aria-label={placementLabel}
            className="flex items-center gap-0.5 rounded-lg border border-[#30363d] p-0.5"
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
                      ? "bg-[#30363d] text-[#e6edf3]"
                      : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]",
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
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function VideoBody({
  videoRef,
  jobId,
  zoom,
  unavailable,
  unavailableLabel,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  jobId: string;
  zoom: PreviewZoom;
  unavailable: boolean;
  unavailableLabel: string;
}) {
  if (unavailable) {
    return (
      <p className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-[#8b949e]">
        {unavailableLabel}
      </p>
    );
  }

  const src = `/api/tools/video-upload/${jobId}/video`;

  // Fill-width: the frame is scaled to the pane width (portrait video grows
  // taller than the pane) and the body scrolls vertically so leaderboard rows
  // read at full width. Fit: whole frame letterboxed within the pane.
  if (zoom === "width") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          className="block h-auto w-full"
        />
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <video
        ref={videoRef}
        src={src}
        controls
        playsInline
        className="h-full w-full object-contain"
      />
    </div>
  );
}
