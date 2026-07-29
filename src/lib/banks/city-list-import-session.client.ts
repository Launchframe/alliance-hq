/**
 * In-memory handoff of screenshot preview URLs from the upload modal to the
 * import-review page. Blob URLs cannot live in sessionStorage with the draft;
 * this cache covers same-tab navigation after parse. Cleared on import/reset.
 */

export type CityListImportScreenshotPreview = {
  id: string;
  previewUrl: string;
  name: string;
};

let screenshotPreviews: CityListImportScreenshotPreview[] = [];

export function setCityListImportScreenshotPreviews(
  next: CityListImportScreenshotPreview[],
): void {
  screenshotPreviews = next;
}

export function getCityListImportScreenshotPreviews(): CityListImportScreenshotPreview[] {
  return screenshotPreviews;
}

export function clearCityListImportScreenshotPreviews(): void {
  for (const shot of screenshotPreviews) {
    try {
      URL.revokeObjectURL(shot.previewUrl);
    } catch {
      // ignore
    }
  }
  screenshotPreviews = [];
}
