/** True when video metadata indicates a portrait capture (height > width). */
export function isPortraitVideo(videoWidth: number, videoHeight: number): boolean {
  return videoWidth > 0 && videoHeight > 0 && videoHeight > videoWidth;
}
