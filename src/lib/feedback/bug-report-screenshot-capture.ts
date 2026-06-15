export type BugReportScreenshotViewport = {
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
};

export type BugReportScreenshotCaptureBand = BugReportScreenshotViewport & {
  captureWidth: number;
  captureHeight: number;
};

export function computeBugReportScreenshotCaptureBand(
  viewport: BugReportScreenshotViewport,
  rootScrollWidth: number,
  rootScrollHeight: number,
): BugReportScreenshotCaptureBand {
  const captureWidth = Math.min(
    Math.max(viewport.viewportWidth, viewport.scrollX + viewport.viewportWidth),
    rootScrollWidth,
  );
  const captureHeight = Math.min(
    viewport.scrollY + viewport.viewportHeight,
    rootScrollHeight,
  );

  return {
    ...viewport,
    captureWidth,
    captureHeight,
  };
}

export function cropCanvasToViewport(
  source: HTMLCanvasElement,
  band: BugReportScreenshotCaptureBand,
): HTMLCanvasElement {
  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = band.viewportWidth;
  croppedCanvas.height = band.viewportHeight;

  const context = croppedCanvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create screenshot canvas context");
  }

  context.drawImage(
    source,
    band.scrollX,
    band.scrollY,
    band.viewportWidth,
    band.viewportHeight,
    0,
    0,
    band.viewportWidth,
    band.viewportHeight,
  );

  return croppedCanvas;
}

export async function canvasToPngBlob(
  canvas: HTMLCanvasElement,
  quality = 0.85,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Screenshot capture returned empty blob"));
      },
      "image/png",
      quality,
    );
  });
}
