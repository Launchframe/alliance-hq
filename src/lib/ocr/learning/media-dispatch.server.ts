import "server-only";

export async function dispatchMediaTask(taskId: string): Promise<boolean> {
  const base = process.env.OCR_WORKER_BASE_URL?.trim();
  const secret = process.env.OCR_WORKER_SECRET;
  if (!base || !secret) return false;
  const origin = new URL(base);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/" || origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) return false;
  const response = await fetch(new URL(`/api/internal/video-process/ocr-media/${encodeURIComponent(taskId)}`, origin), { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(300000) });
  return response.ok;
}
