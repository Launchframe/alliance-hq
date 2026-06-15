"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Camera, Loader2, X } from "lucide-react";
import { domToCanvas } from "modern-screenshot";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { FEEDBACK_FAB_FIXED_CLASSES } from "@/lib/feedback/fab-layout";
import {
  canvasToPngBlob,
  computeBugReportScreenshotCaptureBand,
  cropCanvasToViewport,
} from "@/lib/feedback/bug-report-screenshot-capture";
import {
  FEEDBACK_SCREENSHOT_UI_ATTR,
  MAX_BUG_REPORT_SCREENSHOT_BYTES,
  type CapturedScreenshot,
} from "@/lib/feedback/constants";

type Props = {
  open: boolean;
  onClose: () => void;
  onCapture: (screenshot: CapturedScreenshot) => void;
};

function shouldIncludeInScreenshot(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  return (
    !node.closest(`[${FEEDBACK_SCREENSHOT_UI_ATTR}]`) &&
    !node.closest('[role="dialog"]')
  );
}

export function ScreenshotModeOverlay({ open, onClose, onCapture }: Props) {
  const t = useTranslations("feedback.bugReport");
  const [isCapturing, setIsCapturing] = React.useState(false);
  const [captureError, setCaptureError] = React.useState<string | null>(null);
  const [mounted] = React.useState(() => typeof document !== "undefined");

  if (!open || !mounted) return null;

  async function handleCapture() {
    if (isCapturing) return;
    setIsCapturing(true);
    setCaptureError(null);
    try {
      const root = document.body;
      const band = computeBugReportScreenshotCaptureBand(
        {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
        root.scrollWidth,
        root.scrollHeight,
      );
      const sourceCanvas = await domToCanvas(root, {
        width: band.captureWidth,
        height: band.captureHeight,
        scale: 1,
        filter: shouldIncludeInScreenshot,
        timeout: 15_000,
        features: { restoreScrollPosition: true },
      });
      const cropped = cropCanvasToViewport(sourceCanvas, band);
      const blob = await canvasToPngBlob(cropped, 0.85);
      if (blob.size > MAX_BUG_REPORT_SCREENSHOT_BYTES) {
        setCaptureError(t("screenshotTooLarge"));
        return;
      }
      onCapture({
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(blob),
        blob,
        width: band.viewportWidth,
        height: band.viewportHeight,
      });
      onClose();
    } catch {
      setCaptureError(t("screenshotFailed"));
    } finally {
      setIsCapturing(false);
    }
  }

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[200]"
      {...{ [FEEDBACK_SCREENSHOT_UI_ATTR]: "" }}
      aria-label={t("screenshotMode")}
    >
      {isCapturing ? (
        <div
          className="pointer-events-auto fixed inset-0 z-[202] flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="max-w-md space-y-3 text-center">
            <Loader2
              className="mx-auto h-10 w-10 animate-spin text-white"
              aria-hidden
            />
            <p className="text-base font-medium text-white">{t("capturing")}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="absolute inset-x-0 top-0 z-[201] bg-gradient-to-b from-black/70 via-black/25 to-transparent px-4 py-3">
            <div className="mx-auto flex max-w-3xl items-start justify-between gap-3">
              <Button
                variant="outline"
                size="icon"
                className="pointer-events-auto shrink-0 border-[#484f58] bg-[#161b22]/90 text-white shadow-sm backdrop-blur-sm hover:bg-[#21262d]"
                onClick={onClose}
                aria-label={t("cancel")}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
              <p className="pointer-events-auto min-w-0 text-sm font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
                {t("screenshotHint")}
              </p>
            </div>
            {captureError ? (
              <p className="mt-2 text-center text-sm font-medium text-red-300">
                {captureError}
              </p>
            ) : null}
          </div>

          <div
            className="pointer-events-none absolute inset-x-4 top-16 bottom-24 rounded-lg border-2 border-dashed border-[#238636]/70"
            aria-hidden
          />

          <div
            className={`${FEEDBACK_FAB_FIXED_CLASSES} z-[201]`}
          >
            <Button
              size="icon"
              className="pointer-events-auto h-14 w-14 rounded-full border-2 border-[#30363d] bg-[#238636] p-0 text-white shadow-lg hover:bg-[#2ea043]"
              onClick={handleCapture}
              aria-label={t("takeScreenshot")}
            >
              <Camera className="h-6 w-6" aria-hidden />
            </Button>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
