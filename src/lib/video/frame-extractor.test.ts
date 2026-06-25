import { describe, expect, it } from "vitest";

import {
  assignVideoTimestampsToFrames,
  buildSceneSelectFilter,
  listFrameJpegFiles,
  parseFfmpegShowinfoPtsTimes,
} from "@/lib/video/frame-extractor";

describe("buildSceneSelectFilter", () => {
  it("forces the first frame so t=0 content is never dropped", () => {
    expect(buildSceneSelectFilter(0.25)).toBe(
      "select='eq(n,0)+gt(scene,0.25)',scale=720:-1",
    );
  });

  it("threads the configured scene threshold", () => {
    expect(buildSceneSelectFilter(0.1)).toContain("gt(scene,0.1)");
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
