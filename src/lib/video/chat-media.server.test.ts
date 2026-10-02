import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ putObject: vi.fn(), deleteObject: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/storage", () => mocks);

import sharp from "sharp";
import {
  buildChatMediaArtifact,
  buildChatMediaArtifacts,
  clampCropBox,
  dedupeMediaArtifacts,
  uploadChatMediaArtifacts,
  type ChatMediaArtifact,
} from "./chat-media.server";
import type { ChatExtractedFrame } from "./chat-frames.server";
import type { StitchedChatMedia } from "./chat-parser.shared";

function stitchedMedia(overrides: Partial<StitchedChatMedia> = {}): StitchedChatMedia {
  return {
    kind: "embedded",
    box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    messageLocalId: "m0",
    confidence: 0.9,
    sourceFrameIndex: 0,
    sourceTimestampMs: 0,
    messageIndex: null,
    ...overrides,
  };
}

async function frameWith(png: Buffer, width: number, height: number): Promise<ChatExtractedFrame> {
  return {
    frameIndex: 0, png, filePath: "/tmp/f.png", timestampMs: 0,
    frameHash: "h", width, height, sharpness: 0.5, fingerprint: new Uint8Array(256),
  };
}

function artifact(overrides: Partial<ChatMediaArtifact> = {}): ChatMediaArtifact {
  return {
    media: stitchedMedia(),
    mediaId: "m", storageKey: "k.png", thumbnailStorageKey: "k.webp",
    contentType: "image/png", sha256: "s", width: 64, height: 64,
    sharpness: 0.5, fingerprint: new Uint8Array(256).fill(10),
    png: Buffer.from("png"), thumb: Buffer.from("webp"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.putObject.mockResolvedValue(undefined);
  mocks.deleteObject.mockResolvedValue(undefined);
});

describe("clampCropBox", () => {
  it("maps normalized boxes to integer pixel bounds", () => {
    expect(clampCropBox({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 400, 300)).toEqual({
      left: 100, top: 75, width: 200, height: 150,
    });
  });

  it("clamps boxes reaching the frame edge", () => {
    const crop = clampCropBox({ x: 0.9, y: 0.9, width: 0.1, height: 0.1 }, 600, 600);
    expect(crop).toEqual({ left: 540, top: 540, width: 60, height: 60 });
  });

  it("rejects crops under the 32px minimum", () => {
    expect(clampCropBox({ x: 0, y: 0, width: 0.05, height: 0.5 }, 400, 300)).toBeNull();
    expect(clampCropBox({ x: 0, y: 0, width: 0.5, height: 0.05 }, 400, 300)).toBeNull();
  });
});

describe("buildChatMediaArtifact", () => {
  it("crops losslessly to PNG and bounds the WebP thumbnail without enlarging", async () => {
    const png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 200, b: 90 } },
    }).png().toBuffer();
    const frame = await frameWith(png, 400, 300);
    const built = await buildChatMediaArtifact(stitchedMedia(), frame, "import-1");
    expect(built).not.toBeNull();
    expect(built!.storageKey).toBe("notes-history/import-1/media/" + built!.mediaId + ".png");
    expect(built!.thumbnailStorageKey).toBe("notes-history/import-1/media/" + built!.mediaId + ".webp");
    expect(built!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const [meta, thumbMeta] = await Promise.all([sharp(built!.png).metadata(), sharp(built!.thumb).metadata()]);
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(150);
    expect(thumbMeta.format).toBe("webp");
    expect(thumbMeta.width).toBeLessThanOrEqual(480);
    expect(thumbMeta.height).toBeLessThanOrEqual(480);
    // Crop is already below the thumbnail bound: no enlargement.
    expect(thumbMeta.width).toBeLessThanOrEqual(200);
  });

  it("returns null for crops under the minimum size", async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();
    const frame = await frameWith(png, 64, 64);
    const built = await buildChatMediaArtifact(
      stitchedMedia({ box: { x: 0, y: 0, width: 0.2, height: 0.9 } }),
      frame,
      "import-1",
    );
    expect(built).toBeNull();
  });
});

describe("dedupeMediaArtifacts", () => {
  it("keeps the larger then sharper artifact for identical fingerprints of the same kind", () => {
    const fingerprint = new Uint8Array(256).fill(10);
    const small = artifact({ mediaId: "small", width: 32, height: 32, sharpness: 0.9, fingerprint });
    const large = artifact({ mediaId: "large", width: 64, height: 64, sharpness: 0.4, fingerprint });
    const sameSizeSharper = artifact({ mediaId: "sharp", width: 64, height: 64, sharpness: 0.8, fingerprint });
    const kept = dedupeMediaArtifacts([small, large, sameSizeSharper]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.mediaId).toBe("sharp");
  });

  it("keeps different kinds and different fingerprints", () => {
    const a = artifact({ mediaId: "a", fingerprint: new Uint8Array(256).fill(10) });
    const b = artifact({ mediaId: "b", fingerprint: new Uint8Array(256).fill(200) });
    const c = artifact({ mediaId: "c", media: stitchedMedia({ kind: "fullscreen" }), fingerprint: new Uint8Array(256).fill(10) });
    // "a" and "c" share a fingerprint but differ in kind: only same-kind dupes collapse.
    expect(dedupeMediaArtifacts([a, b, c]).map((x) => x.mediaId).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("buildChatMediaArtifacts", () => {
  async function framePng() {
    return sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 200, b: 90 } },
    }).png().toBuffer();
  }

  it("accumulates artifact bytes and throws chat_import_limit before accepting an overflowing artifact", async () => {
    const png = await framePng();
    const frame = await frameWith(png, 400, 300);
    const first = await buildChatMediaArtifact(stitchedMedia(), frame, "import-1");
    expect(first).not.toBeNull();
    const firstBytes = first!.png.byteLength + first!.thumb.byteLength;
    // Cap admits the first artifact exactly; the second overflows.
    const items = [stitchedMedia(), stitchedMedia({ messageLocalId: "m1" })];
    await expect(
      buildChatMediaArtifacts(items, [frame], "import-1", firstBytes),
    ).rejects.toThrow("chat_import_limit");
    await expect(
      buildChatMediaArtifacts(items, [frame], "import-1", 0),
    ).rejects.toThrow("chat_import_limit");
  });

  it("returns accepted artifacts in order under the cap", async () => {
    const png = await framePng();
    const frame = await frameWith(png, 400, 300);
    const artifacts = await buildChatMediaArtifacts(
      [stitchedMedia(), stitchedMedia({ messageLocalId: "m1" })],
      [frame],
      "import-1",
    );
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]!.mediaId).not.toBe(artifacts[1]!.mediaId);
  });
});

describe("uploadChatMediaArtifacts", () => {
  it("uploads original and thumbnail for every artifact and returns created keys", async () => {
    const a = artifact({ mediaId: "a", storageKey: "a.png", thumbnailStorageKey: "a.webp" });
    const keys = await uploadChatMediaArtifacts([a]);
    expect(keys).toEqual(["a.png", "a.webp"]);
    expect(mocks.putObject).toHaveBeenCalledWith("a.png", a.png);
    expect(mocks.putObject).toHaveBeenCalledWith("a.webp", a.thumb);
  });

  it("deletes already-created keys when a later upload fails", async () => {
    const a = artifact({ storageKey: "a.png", thumbnailStorageKey: "a.webp" });
    const b = artifact({ storageKey: "b.png", thumbnailStorageKey: "b.webp" });
    mocks.putObject.mockImplementation(async (key: string) => {
      if (key === "b.png") throw new Error("upload failed");
    });
    await expect(uploadChatMediaArtifacts([a, b])).rejects.toThrow("upload failed");
    expect(mocks.deleteObject).toHaveBeenCalledWith("a.png");
    expect(mocks.deleteObject).toHaveBeenCalledWith("a.webp");
    expect(mocks.deleteObject).not.toHaveBeenCalledWith("b.png");
  });
});
