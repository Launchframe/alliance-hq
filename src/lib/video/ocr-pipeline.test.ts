import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn();
const extract = vi.fn();

vi.mock("@/lib/base44/fetch", () => ({
  base44UploadFile: (...args: unknown[]) => upload(...args),
  base44ExtractData: (...args: unknown[]) => extract(...args),
}));

import {
  defaultAshFrameConcurrency,
  ocrAllFrames,
} from "@/lib/video/ocr-pipeline";
import { PipelineTimer } from "@/lib/video/pipeline-timer";
import type { ScoreTargetDef } from "@/lib/video/score-targets";

const target = {
  id: "desert-storm",
  labelKey: "x",
  group: "events",
  enabled: true,
  ocrSchema: { type: "object" },
  submitEntity: "DesertStormScore",
  leaderboardModel: "linear-full",
  eventEntity: "DesertStormEvent",
  seriesEntity: null,
  submitMethod: "bulk",
  submitContext: ["eventId", "recordedDate"],
  inHouseOcrAccuracy: "mid",
} satisfies ScoreTargetDef;

describe("ocrAllFrames", () => {
  beforeEach(() => {
    upload.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { file_url: "https://example.com/frame.jpg" };
    });
    extract.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        entries: [{ name: "Player", score: 100 }],
      };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.VIDEO_ASHED_FRAME_CONCURRENCY;
  });

  it("defaults concurrency to 4", () => {
    expect(defaultAshFrameConcurrency()).toBe(4);
    process.env.VIDEO_ASHED_FRAME_CONCURRENCY = "6";
    expect(defaultAshFrameConcurrency()).toBe(6);
    process.env.VIDEO_ASHED_FRAME_CONCURRENCY = "99";
    expect(defaultAshFrameConcurrency()).toBe(8);
  });

  it("uploads frames to Ashed in parallel", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    upload.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inFlight -= 1;
      return { file_url: "https://example.com/frame.jpg" };
    });

    const frames = [0, 1, 2, 3, 4, 5].map((index) => ({
      index,
      buffer: Buffer.from(`frame-${index}`),
    }));

    const started = Date.now();
    const result = await ocrAllFrames({} as never, target, frames, {
      concurrency: 3,
    });
    const elapsed = Date.now() - started;

    expect(result.concurrency).toBe(3);
    expect(upload).toHaveBeenCalledTimes(6);
    expect(extract).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(elapsed).toBeLessThan(6 * 40);
    expect(result.frameTimings).toHaveLength(6);
    expect(result.frameTimings[0]?.uploadMs).toBeGreaterThan(0);
    expect(result.frameTimings[0]?.extractMs).toBeGreaterThan(0);
  });

  it("records per-hop step logs via PipelineTimer", async () => {
    const timer = new PipelineTimer();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await ocrAllFrames({} as never, target, [{ index: 0, buffer: Buffer.from("x") }], {
      timer,
      jobId: "job1",
      concurrency: 1,
    });

    const stepLogs = logSpy.mock.calls
      .filter(([line]) => line === "[video-pipeline] step")
      .map(([, payload]) => JSON.parse(String(payload)));

    expect(stepLogs.some((entry) => entry.step === "ashed.upload")).toBe(true);
    expect(stepLogs.some((entry) => entry.step === "ashed.extract")).toBe(true);
    expect(stepLogs.some((entry) => entry.step === "ashed.batch_complete")).toBe(
      true,
    );
    expect(timer.getPhases()["ashed.upload"]).toBeGreaterThan(0);

    logSpy.mockRestore();
  });

  it("continues batch when a single frame OCR fails", async () => {
    extract
      .mockRejectedValueOnce(new Error("extract failed"))
      .mockResolvedValue({
        entries: [{ name: "Player", score: 100 }],
      });

    const result = await ocrAllFrames(
      {} as never,
      target,
      [
        { index: 0, buffer: Buffer.from("a") },
        { index: 1, buffer: Buffer.from("b") },
      ],
      { concurrency: 1 },
    );

    expect(result.frameTimings).toHaveLength(2);
    expect(result.frameTimings[0]?.error).toBe("extract failed");
    expect(result.frameTimings[0]?.entryCount).toBe(0);
    expect(result.frameTimings[1]?.error).toBeNull();
    expect(result.entries).toHaveLength(1);
  });
});
