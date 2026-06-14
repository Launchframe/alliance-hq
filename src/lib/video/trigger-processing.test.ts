import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({
  waitUntil: (task: Promise<unknown>) => {
    void task;
  },
}));

import { resolveVideoProcessBaseUrl } from "@/lib/video/trigger-processing";

describe("resolveVideoProcessBaseUrl", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.VIDEO_WORKER_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = env;
  });

  it("prefers explicit worker base URL", () => {
    process.env.VIDEO_WORKER_BASE_URL = "https://worker.example/";
    expect(resolveVideoProcessBaseUrl()).toBe("https://worker.example");
  });

  it("falls back to public app URL then Vercel URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://alliance-hq.vercel.app";
    expect(resolveVideoProcessBaseUrl()).toBe("https://alliance-hq.vercel.app");

    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.VERCEL_URL = "preview.vercel.app";
    expect(resolveVideoProcessBaseUrl()).toBe("https://preview.vercel.app");
  });
});
