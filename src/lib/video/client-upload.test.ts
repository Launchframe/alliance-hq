import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadVideoFile, type UploadConfig } from "./client-upload";

const config: UploadConfig = {
  mode: "r2",
  maxUploadBytes: 500 * 1024 * 1024,
  multipartThresholdBytes: 100 * 1024 * 1024,
  multipartPartBytes: 10 * 1024 * 1024,
  legacyDirectPostMaxBytes: 100 * 1024 * 1024,
};

const directConfig: UploadConfig = { ...config, mode: "direct" };

const vsContext = { recordedDate: "2026-09-29", period: "daily" as const };

function videoFile() {
  return new File([new Uint8Array(64)], "match.mp4", { type: "video/mp4" });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("uploadVideoFile vsContext", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends vsContext on upload init for VS jobs", async () => {
    const bodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const target = String(url);
      if (target.endsWith("/init")) {
        bodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ mode: "r2_put", jobId: "job-1", putUrl: "https://r2.example.com/put", contentType: "video/mp4" });
      }
      if (target.endsWith("/complete")) {
        return jsonResponse({ ok: true, jobId: "job-1", status: "queued" });
      }
      throw new Error(`unexpected ${target}`);
    });
    class FakeXhr {
      upload = { onprogress: null as null | (() => void) };
      status = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.status = 200;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    await uploadVideoFile({
      file: videoFile(),
      scoreTarget: "vs-performance",
      vsContext,
      uploadConfig: config,
    });
    expect(bodies[0]).toMatchObject({
      scoreTarget: "vs-performance",
      vsContext: { recordedDate: "2026-09-29", period: "daily" },
    });
  });

  it("serializes vsContext as a form field on legacy direct POST", async () => {
    let form: FormData | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      form = init?.body as FormData;
      return jsonResponse({ ok: true, jobId: "job-9", status: "pending_approval" });
    });
    await uploadVideoFile({
      file: videoFile(),
      scoreTarget: "vs-performance",
      vsContext,
      uploadConfig: directConfig,
    });
    expect(form).not.toBeNull();
    expect(JSON.parse(String(form!.get("vsContext")))).toEqual(vsContext);
  });

  it("omits vsContext when not provided", async () => {
    let body: unknown;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const target = String(url);
      if (target.endsWith("/init")) {
        body = JSON.parse(String(init?.body));
        return jsonResponse({ mode: "direct", maxUploadBytes: 1 });
      }
      throw new Error("stop");
    });
    await expect(
      uploadVideoFile({
        file: videoFile(),
        scoreTarget: "desert-storm",
        uploadConfig: config,
      }),
    ).rejects.toThrow();
    expect(body).toMatchObject({ vsContext: null });
  });

  it("fires onJobCreated as soon as the job row exists, before the video PUT finishes", async () => {
    const order: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const target = String(url);
      if (target.endsWith("/init")) {
        return jsonResponse({ mode: "r2_put", jobId: "job-2", putUrl: "https://r2.example.com/put", contentType: "video/mp4" });
      }
      if (target.endsWith("/complete")) {
        order.push("complete");
        return jsonResponse({ ok: true, jobId: "job-2", status: "queued" });
      }
      throw new Error(`unexpected ${target}`);
    });
    class FakeXhr {
      upload = { onprogress: null as null | (() => void) };
      status = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        order.push("put");
        this.status = 200;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    await uploadVideoFile({
      file: videoFile(),
      scoreTarget: "vs-performance",
      uploadConfig: config,
      onJobCreated: () => order.push("jobCreated"),
    });
    expect(order[0]).toBe("jobCreated");
    expect(order.indexOf("jobCreated")).toBeLessThan(order.indexOf("complete"));
  });
});
