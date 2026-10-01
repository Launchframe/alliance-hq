import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadVideoFile, type UploadConfig } from "./client-upload";

const r2Config: UploadConfig = {
  mode: "r2",
  maxUploadBytes: 96 * 1024 * 1024,
  multipartThresholdBytes: 8 * 1024 * 1024,
  multipartPartBytes: 8 * 1024 * 1024,
  legacyDirectPostMaxBytes: 64 * 1024 * 1024,
};
const directConfig: UploadConfig = { ...r2Config, mode: "direct" };
const file = new File([new Uint8Array(16)], "chat.mp4", { type: "video/mp4" });
const base = { file, scoreTarget: "officer-chat-video", knowledgeImportId: "import-1" };

const jsonResponse = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => { this.onabort?.(); });
  constructor() { FakeXhr.instances.push(this); }
}

afterEach(() => { vi.unstubAllGlobals(); FakeXhr.instances = []; });

describe("uploadVideoFile abort lifecycle", () => {
  it("rejects immediately for a pre-aborted signal without any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(uploadVideoFile({ ...base, uploadConfig: directConfig, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the signal through the direct upload fetch", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse({ ok: true, jobId: "job-1", status: "pending_approval" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const result = await uploadVideoFile({ ...base, uploadConfig: directConfig, signal: controller.signal });
    expect(result.jobId).toBe("job-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes the signal to init, multipart part, and completion fetches", async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | null | undefined> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(init?.signal);
      if (url.endsWith("/init")) return jsonResponse({ mode: "r2_multipart", jobId: "job-2", uploadId: "up-1", presignedParts: [{ partNumber: 1, url: "https://parts/1", start: 0, end: 15 }] });
      if (url === "https://parts/1") return new Response(null, { status: 200, headers: { ETag: '"tag"' } });
      return jsonResponse({ ok: true, jobId: "job-2", status: "pending_approval" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await uploadVideoFile({ ...base, uploadConfig: r2Config, signal: controller.signal });
    expect(result.jobId).toBe("job-2");
    expect(seen).toHaveLength(3);
    expect(seen.every((signal) => signal === controller.signal)).toBe(true);
  });

  it("aborts the in-flight XHR and rejects AbortError while removing the listener", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/init")) return jsonResponse({ mode: "r2_put", jobId: "job-3", putUrl: "https://put/object", contentType: "video/mp4" });
      return jsonResponse({ ok: true, jobId: "job-3" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const pending = uploadVideoFile({ ...base, uploadConfig: r2Config, signal: controller.signal });
    pending.catch(() => undefined);
    await vi.waitFor(() => { expect(FakeXhr.instances).toHaveLength(1); });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.instances[0].abort).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
