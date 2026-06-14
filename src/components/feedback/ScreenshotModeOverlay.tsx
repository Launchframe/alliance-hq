"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { domToCanvas } from "modern-screenshot";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
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
        <div className="pointer-events-auto fixed inset-0 z-[202] flex items-center justify-center bg-black/70 px-6">
          <p className="text-center text-sm text-white">{t("capturing")}</p>
        </div>
      ) : (
        <>
          <div className="absolute inset-x-0 top-0 z-[201] bg-black/70 px-4 py-3">
            <div className="mx-auto flex max-w-3xl items-start justify-between gap-3">
              <Button
                variant="outline"
                size="icon"
                className="pointer-events-auto shrink-0"
                onClick={onClose}
              >
                ✕
              </Button>
              <p className="pointer-events-auto text-sm text-white">
                {t("screenshotHint")}
              </p>
            </div>
            {captureError ? (
              <p className="mt-2 text-center text-sm text-red-300">{captureError}</p>
            ) : null}
          </div>
          <Button
            className="pointer-events-auto fixed bottom-4 left-4 z-[201] h-14 w-14 rounded-full"
            onClick={handleCapture}
            aria-label={t("takeScreenshot")}
          >
            📷
          </Button>
        </>
      )}
    </div>,
    document.body,
  );
}
