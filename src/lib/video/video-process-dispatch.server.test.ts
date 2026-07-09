import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dispatchVideoJobRemote,
  externalVideoWorkerBaseUrl,
  resolveVideoProcessBaseUrl,
  resolveVideoProcessEndpoint,
  videoQueueDispatchesExternally,
} from "@/lib/video/video-process-dispatch.server";

describe("externalVideoWorkerBaseUrl", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = env;
  });

  it("returns null when unset", () => {
    delete process.env.VIDEO_WORKER_BASE_URL;
    expect(externalVideoWorkerBaseUrl()).toBeNull();
  });

  it("trims trailing slash", () => {
    process.env.VIDEO_WORKER_BASE_URL = "https://worker.example/";
    expect(externalVideoWorkerBaseUrl()).toBe("https://worker.example");
  });
});

describe("videoQueueDispatchesExternally", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = env;
  });

  it("is false when worker URL matches app origin", () => {
    process.env.VIDEO_WORKER_BASE_URL = "https://frontline.gay";
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay";
    expect(videoQueueDispatchesExternally()).toBe(false);
  });

  it("is true when worker URL points at another host", () => {
    process.env.VIDEO_WORKER_BASE_URL = "https://video-worker.fly.dev";
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay";
    expect(videoQueueDispatchesExternally()).toBe(true);
  });
});

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

describe("resolveVideoProcessEndpoint", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = env;
  });

  it("uses worker base URL when configured", () => {
    process.env.VIDEO_WORKER_BASE_URL = "https://worker.example";
    expect(resolveVideoProcessEndpoint("job-1")).toBe(
      "https://worker.example/api/internal/video-process/job-1",
    );
  });
});

describe("dispatchVideoJobRemote", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env };
    process.env.VIDEO_WORKER_SECRET = "test-secret";
    process.env.VIDEO_WORKER_BASE_URL = "https://worker.example";
  });

  afterEach(() => {
    process.env = env;
    vi.unstubAllGlobals();
  });

  it("returns 503 when VIDEO_WORKER_SECRET is unset", async () => {
    delete process.env.VIDEO_WORKER_SECRET;
    const result = await dispatchVideoJobRemote("job-1");
    expect(result.httpStatus).toBe(503);
    expect(result.ok).toBe(false);
  });

  it("maps worker JSON payload into a result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          processed: true,
          status: "review",
        }),
      })),
    );

    const result = await dispatchVideoJobRemote("job-1", { source: "cron" });
    expect(result).toMatchObject({
      ok: true,
      processed: true,
      jobId: "job-1",
      status: "review",
      httpStatus: 200,
    });
  });

  it("returns 502 when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const result = await dispatchVideoJobRemote("job-1");
    expect(result.httpStatus).toBe(502);
    expect(result.error).toContain("ECONNREFUSED");
    expect(result.processed).toBe(false);
  });
});
