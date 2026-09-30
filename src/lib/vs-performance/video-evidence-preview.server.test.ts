import { readFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  renderVsVideoEvidencePreview,
  VS_VIDEO_PREVIEW_RECT,
} from "./video-evidence-preview.server";

const fixturesDir = join(__dirname, "fixtures");

function streamOf(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

async function sentinelSource(): Promise<Buffer> {
  const width = 1000;
  const height = 1000;
  const pixels = Buffer.alloc(width * height * 3, 255);
  const sentinelTop = Math.floor(height * 0.9);
  for (let y = sentinelTop; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      pixels[offset] = 255;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 255;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

describe("renderVsVideoEvidencePreview", () => {
  it("crops out footer sentinel pixels outside the ROI", async () => {
    const png = await renderVsVideoEvidencePreview(
      streamOf(await sentinelSource()),
      "daily_totals",
    );
    const { data, info } = await sharp(png)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sentinel = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] > 200) {
        sentinel += 1;
      }
    }
    expect(sentinel).toBe(0);
  });

  it("renders the daily fixture crop as a bounded PNG", async () => {
    const source = await readFile(
      join(fixturesDir, "vs-day-two-completed-redacted.png"),
    );
    const png = await renderVsVideoEvidencePreview(
      streamOf(source),
      "daily_totals",
    );
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBeLessThanOrEqual(1200);
    expect(meta.height).toBeGreaterThan(100);
    const sourceMeta = await sharp(source).metadata();
    const roi = VS_VIDEO_PREVIEW_RECT.daily_totals;
    const expectedHeight = Math.floor(
      (sourceMeta.height ?? 0) * roi.height,
    );
    expect(meta.height).toBeLessThanOrEqual(expectedHeight);
  });

  it("renders the weekly fixture crop as a bounded PNG", async () => {
    const source = await readFile(
      join(fixturesDir, "vs-weekly-two-wins.png"),
    );
    const png = await renderVsVideoEvidencePreview(
      streamOf(source),
      "weekly_overview",
    );
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBeLessThanOrEqual(1200);
    expect(meta.height).toBeGreaterThan(100);
    const stats = await sharp(png).stats();
    expect(stats.channels[0]?.stdev ?? 0).toBeGreaterThan(0);
  });
});
