import { describe, expect, it, vi } from "vitest";
import { fingerprintVideoFile, normalizeChatVideoFile } from "./history-video.client";

const MiB = 1024 * 1024;
const makeFile = (bytes: number, name = "clip.mp4", type = "video/mp4", lastModified = 1_700_000_000_000) =>
  new File([new Uint8Array(bytes).fill(7)], name, { type, lastModified });

const recordSlices = async (file: File) => {
  const original = File.prototype.slice;
  const ranges: Array<[number, number | undefined]> = [];
  const spy = vi.spyOn(File.prototype, "slice").mockImplementation(function (this: File, start?: number, end?: number) {
    ranges.push([start ?? 0, end]);
    return original.call(this, start ?? 0, end);
  });
  try {
    await fingerprintVideoFile(file);
  } finally {
    spy.mockRestore();
  }
  return ranges;
};

describe("fingerprintVideoFile", () => {
  it("returns a deterministic 64-hex fingerprint", async () => {
    const file = makeFile(3 * MiB);
    const first = await fingerprintVideoFile(file);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await fingerprintVideoFile(file)).toBe(first);
  });
  it("reads only bounded first/last slices for large files", async () => {
    expect(await recordSlices(makeFile(3 * MiB))).toEqual([[0, MiB], [2 * MiB, undefined]]);
  });
  it("reads small files entirely once without a duplicate tail", async () => {
    expect(await recordSlices(makeFile(Math.floor(1.5 * MiB)))).toEqual([[0, Math.floor(1.5 * MiB)]]);
  });
  it("fingerprints differ for small files sharing a leading slice but diverging near the end", async () => {
    const first = new Uint8Array(Math.floor(1.5 * MiB)).fill(7);
    const second = first.slice();
    second[second.length - 64] = 9;
    const options = { type: "video/mp4", lastModified: 1_700_000_000_000 };
    expect(await fingerprintVideoFile(new File([first], "clip.mp4", options))).not.toBe(await fingerprintVideoFile(new File([second], "clip.mp4", options)));
  });
  it("keeps slice reads bounded to two 1 MiB ranges for large files", async () => {
    const file = makeFile(5 * MiB);
    const ranges = await recordSlices(file);
    expect(ranges).toEqual([[0, MiB], [4 * MiB, undefined]]);
    expect(ranges.reduce((total, [start, end]) => total + ((end ?? file.size) - start), 0)).toBeLessThanOrEqual(2 * MiB);
  });
  it("changes fingerprint when metadata or tail bytes differ", async () => {
    const base = await fingerprintVideoFile(makeFile(3 * MiB));
    expect(await fingerprintVideoFile(makeFile(3 * MiB, "other.mp4"))).not.toBe(base);
    expect(await fingerprintVideoFile(makeFile(3 * MiB, "clip.mp4", "video/webm"))).not.toBe(base);
    expect(await fingerprintVideoFile(makeFile(3 * MiB, "clip.mp4", "video/mp4", 42))).not.toBe(base);
    const tail = new Uint8Array(3 * MiB).fill(7);
    tail[tail.length - 1] = 9;
    expect(await fingerprintVideoFile(new File([tail], "clip.mp4", { type: "video/mp4", lastModified: 1_700_000_000_000 }))).not.toBe(base);
  });
});

describe("normalizeChatVideoFile", () => {
  it("returns supported video types unchanged", async () => {
    for (const type of ["video/mp4", "video/quicktime", "video/webm"]) {
      const file = makeFile(8, "clip.bin", type);
      expect(normalizeChatVideoFile(file)).toBe(file);
    }
  });
  it("derives the supported type from the extension for missing or octet-stream types", () => {
    for (const [name, type] of [["clip.mp4", "video/mp4"], ["clip.MOV", "video/quicktime"], ["clip.webm", "video/webm"]] as const) {
      for (const source of ["", "application/octet-stream"]) {
        const normalized = normalizeChatVideoFile(makeFile(8, name, source));
        expect(normalized.type).toBe(type);
        expect(normalized.name).toBe(name);
        expect(normalized.lastModified).toBe(1_700_000_000_000);
        expect(normalized.size).toBe(8);
      }
    }
  });
  it("leaves unknown extensions invalid for the schema to reject", () => {
    const file = makeFile(8, "clip.avi", "application/octet-stream");
    expect(normalizeChatVideoFile(file)).toBe(file);
  });
});
