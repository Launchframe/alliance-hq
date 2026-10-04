import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  requireApiSession: vi.fn(), getAshedConnection: vi.fn(),
  sessionCanProcessVideo: vi.fn(), loadAllianceVideoOcrContext: vi.fn(),
  selectLimit: vi.fn(), update: vi.fn(), dispatchVideoProcessing: vi.fn(),
}));
vi.mock("@/lib/session", () => mocks);
vi.mock("@/lib/video/processor-slots.server", () => mocks);
vi.mock("@/lib/video/alliance-ocr-settings.server", () => mocks);
vi.mock("@/lib/video/trigger-processing", () => mocks);
vi.mock("@/lib/bff/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/events/video-jobs", () => ({ emitVideoJobStatus: vi.fn() }));
vi.mock("@/lib/members/roster-ocr/assign-roster-config", () => ({ assignRosterOcrExperiment: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.selectLimit }) }) }),
    update: () => ({ set: mocks.update }),
  }),
  schema: { videoJobs: { id: "id" } },
}));

const job = { id: "job-vs", scoreTarget: "vs-performance", allianceId: "native-alliance", status: "pending_approval" };
const request = () => POST(new Request("http://localhost/approve"), { params: Promise.resolve({ jobId: job.id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VIDEO_OCR_PROVIDER", "ashed");
  mocks.requireApiSession.mockResolvedValue({ id: "processor", hqUserId: "owner", currentAllianceId: job.allianceId });
  mocks.sessionCanProcessVideo.mockResolvedValue(true);
  mocks.selectLimit.mockResolvedValue([job]);
  mocks.getAshedConnection.mockResolvedValue(null);
  mocks.loadAllianceVideoOcrContext.mockResolvedValue({ allianceOperatingMode: "native", allianceHqOcrOnly: false });
  mocks.update.mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: job.id }]),
    }),
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("approve native VS", () => {
  it("queues native VS without looking up credentials or changing alliance settings", async () => {
    expect((await request()).status).toBe(200);
    expect(mocks.getAshedConnection).not.toHaveBeenCalled();
    expect(mocks.loadAllianceVideoOcrContext).toHaveBeenCalledWith(job.allianceId);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: "queued", processingSessionId: "processor" }));
    expect(mocks.dispatchVideoProcessing).toHaveBeenCalledWith(job.id, { source: "approve" });
  });

  it("returns 409 when pending_approval CAS loses to concurrent reject", async () => {
    mocks.update.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });
    const res = await request();
    expect(res.status).toBe(409);
    expect(mocks.dispatchVideoProcessing).not.toHaveBeenCalled();
  });

  it.each([
    { allianceOperatingMode: "ashed", scoreTarget: "vs-performance" },
    { allianceOperatingMode: "native", scoreTarget: "desert-storm" },
  ])("keeps credential gate for $allianceOperatingMode $scoreTarget", async ({ allianceOperatingMode, scoreTarget }) => {
    mocks.loadAllianceVideoOcrContext.mockResolvedValue({ allianceOperatingMode });
    mocks.selectLimit.mockResolvedValue([{ ...job, scoreTarget }]);
    const res = await request();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("ashed_not_connected");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.dispatchVideoProcessing).not.toHaveBeenCalled();
  });

  it("denies unauthorized processors before reading a job", async () => {
    mocks.sessionCanProcessVideo.mockResolvedValue(false);
    expect((await request()).status).toBe(403);
    expect(mocks.selectLimit).not.toHaveBeenCalled();
    expect(mocks.dispatchVideoProcessing).not.toHaveBeenCalled();
  });

  it("forwards unauthenticated session responses", async () => {
    mocks.requireApiSession.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await request()).status).toBe(401);
    expect(mocks.sessionCanProcessVideo).not.toHaveBeenCalled();
  });

  it("rejects another alliance's job before context lookup", async () => {
    mocks.selectLimit.mockResolvedValue([{ ...job, allianceId: "other" }]);
    expect((await request()).status).toBe(404);
    expect(mocks.loadAllianceVideoOcrContext).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
