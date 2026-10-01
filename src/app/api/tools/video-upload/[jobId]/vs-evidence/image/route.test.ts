import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(),
  resolveVsVideoAccess: vi.fn(),
  getVsVideoImage: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  requireApiSession: mocks.requireApiSession,
}));
vi.mock("@/lib/vs-performance/video-evidence.server", () => ({
  resolveVsVideoAccess: mocks.resolveVsVideoAccess,
  getVsVideoImage: mocks.getVsVideoImage,
}));

import { GET } from "./route";
import { VsPerformanceError } from "@/lib/vs-performance/weekly-plan.shared";

const params = Promise.resolve({ jobId: "job-vs-1" });
const access = {
  actor: { sessionId: "s1", hqUserId: "u1", allianceId: "a1" },
  job: { id: "job-vs-1" },
  scopeKey: "group:g1",
};

async function tinyPng(): Promise<ReadableStream<Uint8Array>> {
  const buffer = await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

function req(url: string) {
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiSession.mockResolvedValue({
    id: "s1",
    hqUserId: "u1",
    currentAllianceId: "a1",
  });
  mocks.resolveVsVideoAccess.mockResolvedValue(access);
});

describe("vs-evidence image route", () => {
  it("forwards anonymous responses before any work", async () => {
    mocks.requireApiSession.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await GET(
      req("http://localhost/api/tools/video-upload/job-vs-1/vs-evidence/image"),
      { params },
    );
    expect(res.status).toBe(401);
    expect(mocks.resolveVsVideoAccess).not.toHaveBeenCalled();
  });

  it("serves a rendered PNG preview for a sealed capture", async () => {
    mocks.getVsVideoImage.mockResolvedValue({
      stream: await tinyPng(),
      kind: "daily_totals",
      imageVersion: 2,
    });
    const res = await GET(
      req(
        "http://localhost/api/tools/video-upload/job-vs-1/vs-evidence/image?imageVersion=2",
      ),
      { params },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.getVsVideoImage).toHaveBeenCalledWith(access, 2);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  });

  it("surfaces a stale image version as 409", async () => {
    mocks.getVsVideoImage.mockRejectedValue(
      new VsPerformanceError("stale", 409),
    );
    const res = await GET(
      req(
        "http://localhost/api/tools/video-upload/job-vs-1/vs-evidence/image?imageVersion=1",
      ),
      { params },
    );
    expect(res.status).toBe(409);
  });

  it("rejects a malformed imageVersion parameter", async () => {
    const res = await GET(
      req(
        "http://localhost/api/tools/video-upload/job-vs-1/vs-evidence/image?imageVersion=abc",
      ),
      { params },
    );
    expect(res.status).toBe(400);
    expect(mocks.getVsVideoImage).not.toHaveBeenCalled();
  });
});
