import "server-only";

export async function dispatchMediaTask(origin: string, taskId: string): Promise<void> {
  const secret = process.env.OCR_WORKER_SECRET;
  if (!secret) throw new Error("ocr_worker_secret_not_configured");
  const parsed = new URL(origin);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/" || parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))) {
    throw new Error("invalid_worker_origin");
  }
  const response = await fetch(new URL(`/api/internal/video-process/ocr-media/${encodeURIComponent(taskId)}`, parsed), { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(300000) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw Object.assign(new Error("media_dispatch_failed"), { status: response.status, body });
  }
}
