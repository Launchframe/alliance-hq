/**
 * Paths served when VIDEO_WORKER_MODE=1 (dedicated OCR host).
 * Keep in sync with deploy/video-worker docs and middleware.
 */
export function isVideoWorkerAllowedPath(pathname: string): boolean {
  if (pathname === "/api/internal/video-worker/health") {
    return true;
  }
  if (pathname.startsWith("/api/internal/video-process/")) {
    return true;
  }
  if (pathname.startsWith("/api/internal/video-archive/")) {
    return true;
  }
  return false;
}
