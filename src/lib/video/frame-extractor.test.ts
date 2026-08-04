import { describe, expect, it } from "vitest";

import {
  assignVideoTimestampsToFrames,
  buildSceneSelectFilter,
  forcedFirstFrameIndexForFps,
  listFrameJpegFiles,
  mergeSceneFramesWithBookends,
  parseFfprobeFrameRate,
  parseFfmpegDurationSeconds,
  parseFfmpegFrameRateFromStderr,
  parseFfmpegShowinfoPtsTimes,
  supplementFrameIntervalForFps,
} from "@/lib/video/frame-extractor";

describe("parseFfmpegDurationSeconds", () => {
  it("parses Duration from ffmpeg -i stderr", () => {
    const stderr = `ffmpeg version 6.0
  Duration: 00:01:23.45, start: 0.000000, bitrate: 1024 kb/s`;
    expect(parseFfmpegDurationSeconds(stderr)).toBeCloseTo(83.45, 2);
  });

  it("returns null when duration is missing", () => {
    expect(parseFfmpegDurationSeconds("no duration here")).toBeNull();
  });
});

describe("parseFfmpegFrameRateFromStderr", () => {
  it("parses nominal fps from stream line", () => {
    const stderr = `Stream #0:0: Video: h264, yuv420p, 1280x720, 29.97 fps, 30 tbr`;
    expect(parseFfmpegFrameRateFromStderr(stderr)).toBeCloseTo(29.97, 2);
  });

  it("returns null when fps is missing", () => {
    expect(parseFfmpegFrameRateFromStderr("no fps")).toBeNull();
  });
});

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
  it("targets ~50ms from probed frame rate", () => {
    expect(forcedFirstFrameIndexForFps(30)).toBe(2);
    expect(forcedFirstFrameIndexForFps(60)).toBe(3);
    expect(
      forcedFirstFrameIndexForFps(parseFfprobeFrameRate("30000/1001")),
    ).toBe(1);
  });

  it("falls back to frame 2 when fps is unknown", () => {
    expect(forcedFirstFrameIndexForFps(null)).toBe(2);
  });
});

describe("buildSceneSelectFilter", () => {
  it("selects scene changes only (bookends are extracted separately)", () => {
    expect(buildSceneSelectFilter(0.25)).toBe("select='gt(scene,0.25)'");
  });

  it("threads the configured scene threshold", () => {
    expect(buildSceneSelectFilter(0.1)).toContain("gt(scene,0.1)");
  });

  it("never downscales OCR frames (no scale= filter)", () => {
    expect(buildSceneSelectFilter(0.25)).not.toContain("scale=");
  });

  it("adds periodic fps supplement when configured", () => {
    expect(buildSceneSelectFilter(0.1, 15)).toBe(
      "select='gt(scene,0.1)+eq(mod(n\\,15),0)'",
    );
  });
});

describe("mergeSceneFramesWithBookends", () => {
  it("returns bookends when scene detection produced no frames", () => {
    const merged = mergeSceneFramesWithBookends(
      [],
      [
        {
          index: 0,
          filePath: "/tmp/open.jpg",
          buffer: Buffer.from("open"),
          videoTimestampSeconds: 0.05,
        },
        {
          index: 0,
          filePath: "/tmp/close.jpg",
          buffer: Buffer.from("close"),
          videoTimestampSeconds: 9.95,
        },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((frame) => frame.videoTimestampSeconds)).toEqual([
      0.05, 9.95,
    ]);
  });

  it("sorts by timestamp and dedupes near-duplicate bookends", () => {
    const merged = mergeSceneFramesWithBookends(
      [
        {
          index: 0,
          filePath: "/tmp/scene.jpg",
          buffer: Buffer.from("scene"),
          videoTimestampSeconds: 1,
        },
      ],
      [
        {
          index: 0,
          filePath: "/tmp/open.jpg",
          buffer: Buffer.from("open"),
          videoTimestampSeconds: 0.1,
        },
        {
          index: 0,
          filePath: "/tmp/dup.jpg",
          buffer: Buffer.from("dup"),
          videoTimestampSeconds: 0.11,
        },
      ],
    );
    expect(merged.map((frame) => frame.videoTimestampSeconds)).toEqual([
      0.1, 1,
    ]);
    expect(merged.map((frame) => frame.index)).toEqual([0, 1]);
  });
});

describe("supplementFrameIntervalForFps", () => {
  it("floors the interval so supplement rate is at least the target fps", () => {
    expect(supplementFrameIntervalForFps(25, 2)).toBe(12);
    expect(supplementFrameIntervalForFps(30, 2)).toBe(15);
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
