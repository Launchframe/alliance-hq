import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveOcrMediaDispatchOrigin } from "./media-dispatch.server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveOcrMediaDispatchOrigin", () => {
  it("uses the canonical app origin, not a request host", () => {
    vi.stubEnv("OCR_WORKER_BASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://frontline.gay");
    expect(resolveOcrMediaDispatchOrigin()).toBe("https://frontline.gay");
  });

  it("accepts an operator worker origin and rejects userinfo or a non-root path", () => {
    vi.stubEnv("OCR_WORKER_BASE_URL", "https://ocr-worker.example/");
    expect(resolveOcrMediaDispatchOrigin()).toBe("https://ocr-worker.example");
    vi.stubEnv("OCR_WORKER_BASE_URL", "https://user:secret@ocr-worker.example");
    expect(() => resolveOcrMediaDispatchOrigin()).toThrow("invalid_worker_origin");
    vi.stubEnv("OCR_WORKER_BASE_URL", "https://ocr-worker.example/dispatch");
    expect(() => resolveOcrMediaDispatchOrigin()).toThrow("invalid_worker_origin");
  });
});
