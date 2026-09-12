import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/rbac/require-permission", () => ({ getRbacContext: vi.fn(), requirePlatformMaintainer: vi.fn() }));

import { readOcrJson } from "./api.server";

function request(body: BodyInit, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("http://localhost/api/admin/ocr-learning/datasets", { method: "POST", headers, body });
}

describe("bounded OCR learning JSON", () => {
  it("accepts Unicode JSON and rejects non-object or malformed bodies", async () => {
    await expect(readOcrJson(request('{"name":"Álpha"}'))).resolves.toEqual({ name: "Álpha" });
    await expect(readOcrJson(request("[]"))).rejects.toMatchObject({ code: "invalid_request" });
    await expect(readOcrJson(request("{"))).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("requires JSON content type and refuses oversized declared and streamed bodies", async () => {
    await expect(readOcrJson(request("{}", { "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
    await expect(readOcrJson(request("{}", { "content-type": "application/json", "content-length": "9999999" }))).rejects.toMatchObject({ status: 413 });
    await expect(readOcrJson(request(" ".repeat(2 * 1024 * 1024 + 1)))).rejects.toMatchObject({ status: 413 });
  });

  it("rejects corrupt UTF-8 instead of silently changing labels", async () => {
    await expect(readOcrJson(request(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125])))).rejects.toMatchObject({ code: "invalid_request" });
  });
});
