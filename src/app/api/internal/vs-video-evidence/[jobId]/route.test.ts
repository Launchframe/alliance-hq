import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ processVsVideoEvidence: vi.fn() }));

vi.mock("@/lib/vs-performance/video-evidence-process.server", () => mocks);

import { POST } from "./route";

const params = Promise.resolve({ jobId: "job-vs-1" });

function req(auth?: string) {
  return new Request("http://localhost/api/internal/vs-video-evidence/job-vs-1", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VIDEO_WORKER_SECRET", "worker-secret");
  mocks.processVsVideoEvidence.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("internal vs-video-evidence worker route", () => {
  it("returns 503 without a configured secret", async () => {
    vi.stubEnv("VIDEO_WORKER_SECRET", "");
    const res = await POST(req("Bearer worker-secret"), { params });
    expect(res.status).toBe(503);
    expect(mocks.processVsVideoEvidence).not.toHaveBeenCalled();
  });

  it("denies missing or wrong bearer tokens", async () => {
    expect((await POST(req(), { params })).status).toBe(403);
    expect((await POST(req("Bearer nope"), { params })).status).toBe(403);
    expect((await POST(req("Bearer worker-secret-extra"), { params })).status).toBe(403);
    const sameLengthNonAscii = await POST(req("Bearer worker-secreé"), { params });
    expect(sameLengthNonAscii.status).toBe(403);
    expect(mocks.processVsVideoEvidence).not.toHaveBeenCalled();
  });

  it("processes the job with a valid token", async () => {
    const res = await POST(req("Bearer worker-secret"), { params });
    expect(res.status).toBe(200);
    expect(mocks.processVsVideoEvidence).toHaveBeenCalledWith("job-vs-1");
  });
});
