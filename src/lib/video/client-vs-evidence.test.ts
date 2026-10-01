import { afterEach, describe, expect, it, vi } from "vitest";

import {
  uploadVsVideoScreenshot,
  VsVideoClientError,
} from "./client-vs-evidence";

function pngFile(size = 1024) {
  return new File([new Uint8Array(size)], "shot.png", { type: "image/png" });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const okEvidence = { evidence: { version: 2, imageVersion: 1 } };

describe("uploadVsVideoScreenshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs init → presigned R2 PUT → complete and returns the response", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        calls.push({ url: String(url), init });
        const target = String(url);
        if (target.endsWith("/vs-evidence") && init?.method === "POST") {
          return jsonResponse({
            mode: "r2_put",
            putUrl: "https://r2.example.com/signed-upload?X-Amz-Signature=abc",
            imageVersion: 1,
            contentType: "image/png",
          });
        }
        if (target.startsWith("https://r2.example.com/")) {
          return new Response(null, { status: 200 });
        }
        if (target.endsWith("/complete")) {
          return jsonResponse(okEvidence);
        }
        throw new Error(`unexpected fetch ${target}`);
      });
    const result = await uploadVsVideoScreenshot("job-1", pngFile(), 0);
    expect(result).toEqual(okEvidence);
    const init = calls.find((c) => c.url.endsWith("/vs-evidence"));
    expect(JSON.parse(String(init?.init?.body))).toMatchObject({
      expectedVersion: 0,
      fileName: "shot.png",
      fileSize: 1024,
      contentType: "image/png",
      requestedKind: "auto",
    });
    const put = calls.find((c) => c.url.startsWith("https://r2.example.com/"));
    expect(put?.init?.method).toBe("PUT");
    expect(
      (put?.init?.headers as Record<string, string>)["Content-Type"],
    ).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the local raw PUT path for direct mode", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const target = String(url);
      calls.push(target);
      if (target.endsWith("/vs-evidence")) {
        return jsonResponse({
          mode: "direct",
          imageVersion: 4,
          contentType: "image/png",
        });
      }
      if (target.includes("/upload?imageVersion=4")) {
        return jsonResponse({ ok: true });
      }
      if (target.endsWith("/complete")) {
        return jsonResponse(okEvidence);
      }
      throw new Error(`unexpected fetch ${target}`);
    });
    await uploadVsVideoScreenshot("job-1", pngFile(), 1);
    expect(
      calls.some((u) => u.includes("/vs-evidence/upload?imageVersion=4")),
    ).toBe(true);
  });

  it("surfaces the server code on a stale init", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ code: "stale" }, 409),
    );
    await expect(
      uploadVsVideoScreenshot("job-1", pngFile(), 2),
    ).rejects.toMatchObject({ code: "stale", status: 409 });
  });

  it("fails when the R2 PUT rejects without leaking the signed URL", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "POST" && target.endsWith("/vs-evidence")) {
        return jsonResponse({
          mode: "r2_put",
          putUrl: "https://r2.example.com/secret?X-Amz-Signature=abc123",
          imageVersion: 1,
          contentType: "image/png",
        });
      }
      return new Response("<Error>AccessDenied</Error>", { status: 403 });
    });
    const error = await uploadVsVideoScreenshot("job-1", pngFile(), 0).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(VsVideoClientError);
    expect(JSON.stringify(error)).not.toContain("X-Amz-Signature");
    expect(JSON.stringify(error)).not.toContain("AccessDenied");
  });

  it("surfaces complete failures as coded errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const target = String(url);
      if (init?.method === "POST" && target.endsWith("/vs-evidence")) {
        return jsonResponse({
          mode: "direct",
          imageVersion: 2,
          contentType: "image/png",
        });
      }
      if (target.includes("/upload?")) return jsonResponse({ ok: true });
      return jsonResponse({ code: "expired" }, 409);
    });
    await expect(
      uploadVsVideoScreenshot("job-1", pngFile(), 0),
    ).rejects.toMatchObject({ code: "expired", status: 409 });
  });

  it("rejects non-image and oversized files before any request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      uploadVsVideoScreenshot(
        "job-1",
        new File(["x"], "a.gif", { type: "image/gif" }),
        0,
      ),
    ).rejects.toMatchObject({ code: "invalid_file_type" });
    await expect(
      uploadVsVideoScreenshot(
        "job-1",
        new File([new Uint8Array(21 * 1024 * 1024)], "big.png", {
          type: "image/png",
        }),
        0,
      ),
    ).rejects.toMatchObject({ code: "invalid_file_size" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates abort signals to every request", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return jsonResponse({});
    });
    await expect(
      uploadVsVideoScreenshot("job-1", pngFile(), 0, "auto", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
