import "server-only";

import { resolveAppOrigin } from "@/lib/app-origin";

/** Operator worker origin, else the canonical app origin. Never the request Host. */
export function resolveOcrMediaDispatchOrigin(): string {
  const raw = process.env.OCR_WORKER_BASE_URL?.trim();
  const origin = raw ? raw.replace(/\/$/, "") : resolveAppOrigin();
  const parsed = new URL(origin);
  const localHttp =
    parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/" ||
    (parsed.protocol !== "https:" && !localHttp)
  ) {
    throw new Error("invalid_worker_origin");
  }
  return parsed.origin;
}

export async function dispatchMediaTask(taskId: string): Promise<void> {
  const secret = process.env.OCR_WORKER_SECRET;
  if (!secret) throw new Error("ocr_worker_secret_not_configured");
  const origin = resolveOcrMediaDispatchOrigin();
  const response = await fetch(new URL(`/api/internal/video-process/ocr-media/${encodeURIComponent(taskId)}`, origin), { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(300000) });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw Object.assign(new Error("media_dispatch_failed"), { status: response.status, body });
  }
}
