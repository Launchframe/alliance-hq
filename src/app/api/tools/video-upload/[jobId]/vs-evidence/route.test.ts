import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  resolveVsVideoAccess: vi.fn(),
  loadVsVideoEvidence: vi.fn(),
  updateVsVideoEvidence: vi.fn(),
  beginVsVideoImageUpload: vi.fn(),
  removeVsVideoImage: vi.fn(),
}));

vi.mock("@/lib/session", () => mocks);
vi.mock("@/lib/vs-performance/video-evidence.server", () => mocks);

import { DELETE, GET, PATCH, POST } from "./route";

const params = Promise.resolve({ jobId: "job-vs-1" });
const access = { actor: { sessionId: "s1", hqUserId: "u1", allianceId: "a1" }, job: { id: "job-vs-1" }, scopeKey: "group:g1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiSession.mockResolvedValue({ id: "s1", hqUserId: "u1", currentAllianceId: "a1" });
  mocks.resolveVsVideoAccess.mockResolvedValue(access);
  mocks.loadVsVideoEvidence.mockResolvedValue({ evidence: { version: 1 } });
  mocks.updateVsVideoEvidence.mockResolvedValue({ evidence: { version: 2 } });
  mocks.beginVsVideoImageUpload.mockResolvedValue({ mode: "direct", imageVersion: 1, version: 2, contentType: "image/png" });
  mocks.removeVsVideoImage.mockResolvedValue({ evidence: { status: "none" } });
});

function req(method: string, body?: unknown) {
  return new Request("http://localhost/api/tools/video-upload/job-vs-1/vs-evidence", {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("vs-evidence route authorization and modes", () => {
  it("forwards anonymous responses before any work", async () => {
    mocks.requireApiSession.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await GET(req("GET"), { params })).status).toBe(401);
    expect((await POST(req("POST", {}), { params })).status).toBe(401);
    expect((await PATCH(req("PATCH", {}), { params })).status).toBe(401);
    expect((await DELETE(req("DELETE", {}), { params })).status).toBe(401);
    expect(mocks.resolveVsVideoAccess).not.toHaveBeenCalled();
  });

  it("denies sessions without an hq user", async () => {
    mocks.requireApiSession.mockResolvedValue({ id: "s1", hqUserId: null, currentAllianceId: "a1" });
    const res = await GET(req("GET"), { params });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
  });

  it("uses read access for GET", async () => {
    await GET(req("GET"), { params });
    expect(mocks.resolveVsVideoAccess).toHaveBeenCalledWith("s1", "job-vs-1", "read");
  });

  it("uses upload access for POST and DELETE", async () => {
    await POST(req("POST", { expectedVersion: 0, fileName: "a.png", fileSize: 10, contentType: "image/png" }), { params });
    expect(mocks.resolveVsVideoAccess).toHaveBeenCalledWith("s1", "job-vs-1", "upload");
    await DELETE(req("DELETE", { expectedVersion: 1 }), { params });
    expect(mocks.removeVsVideoImage).toHaveBeenCalledWith(access, 1);
  });

  it("gates PATCH on review access only when a draft is present", async () => {
    await PATCH(req("PATCH", { expectedVersion: 1, context: { recordedDate: "2026-09-29", period: "daily" } }), { params });
    expect(mocks.resolveVsVideoAccess).toHaveBeenLastCalledWith("s1", "job-vs-1", "upload");
    await PATCH(req("PATCH", { expectedVersion: 1, draft: null }), { params });
    expect(mocks.resolveVsVideoAccess).toHaveBeenLastCalledWith("s1", "job-vs-1", "review");
    await PATCH(req("PATCH", { expectedVersion: 1, context: { recordedDate: "2026-09-29", period: "daily" }, draft: null }), { params });
    expect(mocks.resolveVsVideoAccess).toHaveBeenLastCalledWith("s1", "job-vs-1", "review");
  });

  it("rejects a non-numeric delete expectedVersion", async () => {
    const res = await DELETE(req("DELETE", { expectedVersion: "3" }), { params });
    expect(res.status).toBe(400);
    expect(mocks.removeVsVideoImage).not.toHaveBeenCalled();
  });
});
