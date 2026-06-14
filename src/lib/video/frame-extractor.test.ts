import { describe, expect, it } from "vitest";

import { listFrameJpegFiles } from "@/lib/video/frame-extractor";

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
