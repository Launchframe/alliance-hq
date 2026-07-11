import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("video-worker health GET", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("404s when VIDEO_WORKER_MODE is unset", async () => {
    vi.stubEnv("VIDEO_WORKER_MODE", "");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns liveness JSON when VIDEO_WORKER_MODE=1", async () => {
    vi.stubEnv("VIDEO_WORKER_MODE", "1");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      service: "video-worker",
      workerMode: true,
    });
  });
});
