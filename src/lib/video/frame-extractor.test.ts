import { describe, expect, it } from "vitest";

import {
  assignVideoTimestampsToFrames,
  buildSceneSelectFilter,
  forcedFirstFrameIndexForFps,
  listFrameJpegFiles,
  parseFfprobeFrameRate,
  parseFfmpegShowinfoPtsTimes,
} from "@/lib/video/frame-extractor";

describe("parseFfprobeFrameRate", () => {
  it("parses fractional avg_frame_rate", () => {
    expect(parseFfprobeFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFfprobeFrameRate("30/1")).toBe(30);
  });

  it("returns null for invalid values", () => {
    expect(parseFfprobeFrameRate(undefined)).toBeNull();
    expect(parseFfprobeFrameRate("0/1")).toBeNull();
  });
});

describe("forcedFirstFrameIndexForFps", () => {
  it("targets ~100ms from probed frame rate", () => {
    expect(forcedFirstFrameIndexForFps(30)).toBe(3);
    expect(forcedFirstFrameIndexForFps(60)).toBe(6);
  });

  it("falls back to frame 3 when fps is unknown", () => {
    expect(forcedFirstFrameIndexForFps(null)).toBe(3);
  });
});

describe("buildSceneSelectFilter", () => {
  it("forces one opening frame ~100ms in (not n=0)", () => {
    expect(buildSceneSelectFilter(0.25, 3)).toBe(
      "select='eq(n,3)+gt(scene,0.25)',scale=720:-1",
    );
  });

  it("threads the configured scene threshold", () => {
    expect(buildSceneSelectFilter(0.1, 6)).toContain("gt(scene,0.1)");
    expect(buildSceneSelectFilter(0.1, 6)).toContain("eq(n,6)");
  });
});

describe("listFrameJpegFiles", () => {
  it("returns sorted frame jpeg filenames", () => {
    expect(
      listFrameJpegFiles([
        "frame_0002.jpg",
        "notes.txt",
        "frame_0001.jpg",
        "frame_0010.jpg",
      ]),
    ).toEqual(["frame_0001.jpg", "frame_0002.jpg", "frame_0010.jpg"]);
  });
});

describe("parseFfmpegShowinfoPtsTimes", () => {
  it("extracts pts_time values in order", () => {
    const stderr = `
[Parsed_showinfo_0 @ 0xabc] n:   0 pts:      0 pts_time:0
[Parsed_showinfo_0 @ 0xabc] n:   1 pts:  90000 pts_time:1.5
[Parsed_showinfo_0 @ 0xabc] n:   2 pts: 180000 pts_time:3
`;
    expect(parseFfmpegShowinfoPtsTimes(stderr)).toEqual([0, 1.5, 3]);
  });
});

describe("assignVideoTimestampsToFrames", () => {
  it("uses showinfo pts when available", () => {
    const frames = assignVideoTimestampsToFrames(
      [{ index: 0, filePath: "/tmp/f0.jpg", buffer: Buffer.from("") }],
      "pts_time:12.25",
      "scene",
      1,
    );
    expect(frames[0]?.videoTimestampSeconds).toBe(12.25);
  });

  it("falls back to fps index math in fps mode", () => {
    const frames = assignVideoTimestampsToFrames(
      [
        { index: 0, filePath: "/tmp/f0.jpg", buffer: Buffer.from("") },
        { index: 1, filePath: "/tmp/f1.jpg", buffer: Buffer.from("") },
      ],
      "",
      "fps",
      2,
    );
    expect(frames[0]?.videoTimestampSeconds).toBe(0);
    expect(frames[1]?.videoTimestampSeconds).toBe(0.5);
  });
});
