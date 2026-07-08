import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  externalVideoWorkerBaseUrl,
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
