import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSession: vi.fn(), sessionCanReadAllianceVideoQueue: vi.fn(),
  loadAllianceVideoOcrContext: vi.fn(), rows: vi.fn(),
}));
vi.mock("@/lib/session", () => mocks);
vi.mock("@/lib/video/processor-slots.server", () => mocks);
vi.mock("@/lib/video/alliance-ocr-settings.server", () => mocks);
vi.mock("@/lib/db", async () => ({
  schema: await import("@/lib/db/schema"),
  getDb: () => ({ select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: mocks.rows }) }) }) }) }),
}));
import { listVideoQueueJobsForSession } from "./video-queue.server";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VIDEO_OCR_PROVIDER", "ashed");
  mocks.loadSession.mockResolvedValue({ id: "session", hqUserId: "owner", currentAllianceId: "native-alliance" });
  mocks.sessionCanReadAllianceVideoQueue.mockResolvedValue(true);
  mocks.loadAllianceVideoOcrContext.mockImplementation(async (allianceId) => ({ allianceOperatingMode: allianceId === "native-alliance" ? "native" : "ashed" }));
});
afterEach(() => vi.unstubAllEnvs());

const row = (id: string, scoreTarget: string, allianceId: string) => ({ id, scoreTarget, allianceId, createdAt: new Date(), status: "pending_approval" });

describe("queue per-job credential gates", () => {
  it("uses each job's alliance and target in a mixed queue without mutating global settings", async () => {
    mocks.loadSession.mockResolvedValue({ id: "session", hqUserId: "owner", currentAllianceId: null });
    mocks.rows.mockResolvedValue([
      row("native-vs", "vs-performance", "native-alliance"),
      row("native-ds", "desert-storm", "native-alliance"),
      row("ashed-vs", "vs-performance", "ashed-alliance"),
    ]);
    const jobs = await listVideoQueueJobsForSession("session");
    expect(jobs.map((job) => [job.id, job.requiresAshedConnection])).toEqual([
      ["native-vs", false], ["native-ds", true], ["ashed-vs", true],
    ]);
    expect(mocks.loadAllianceVideoOcrContext).toHaveBeenCalledTimes(2);
  });

  it("never reads jobs or OCR context for unauthorized queue readers", async () => {
    mocks.sessionCanReadAllianceVideoQueue.mockResolvedValue(false);
    expect(await listVideoQueueJobsForSession("session")).toEqual([]);
    expect(mocks.rows).not.toHaveBeenCalled();
    expect(mocks.loadAllianceVideoOcrContext).not.toHaveBeenCalled();
  });
});
