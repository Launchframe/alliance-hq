import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { findVsCaptureTitle, parseVsCaptureImage, parseVsCaptureImageAuto } from "./vs-capture-ocr.server";

const daily = "src/lib/vs-performance/fixtures/vs-daily-totals-redacted.png";
const weekly =
  "src/lib/vs-performance/fixtures/vs-weekly-overview-redacted.png";

describe("parseVsCaptureImage redacted game fixtures", () => {
  it("reads the ongoing daily duel: day 2, LFgo/TriV, score 0", async () => {
    const candidate = await parseVsCaptureImage(
      readFileSync(daily),
      "daily_totals",
    );
    expect(candidate.kind).toBe("daily_totals");
    expect(candidate.day).toBe(2);
    expect(candidate.left.tag).toBe("LFgo");
    expect(candidate.right.tag).toBe("TriV");
    expect(candidate.leftScore).toBe("0");
    expect(candidate.rightScore).toBe("0");
    expect(candidate.ongoing).toBe(true);
    expect(
      candidate.dayResults.every((day) => day.winner === "unknown"),
    ).toBe(true);
  }, 300_000);

  it("reads the weekly overview: servers 1203/1236, left points 0, partial identity", async () => {
    const candidate = await parseVsCaptureImage(
      readFileSync(weekly),
      "weekly_overview",
    );
    expect(candidate.kind).toBe("weekly_overview");
    expect(candidate.left.server).toBe(1203);
    expect(candidate.right.server).toBe(1236);
    expect(candidate.leftPoints).toBe(0);
    expect(
      candidate.dayResults.every((day) => day.winner === "unknown"),
    ).toBe(true);
    expect(candidate.partial).toBe(true);
  }, 300_000);

  it("recognizes a split daily title only when its parts are adjacent", () => {
    const duel = {text:"DUEL",bbox:{x0:649,y0:119,x1:828,y1:210}};
    const themes = {text:"THEMES",bbox:{x0:864,y0:25,x1:1165,y1:207}};
    expect(findVsCaptureTitle("daily_totals", [themes,duel],1800)?.bbox).toEqual({x0:649,y0:25,x1:1165,y1:210});
    expect(findVsCaptureTitle("daily_totals", [duel,{...themes,bbox:{...themes.bbox,y0:300,y1:380}}],1800)).toBeUndefined();
    expect(findVsCaptureTitle("daily_totals", [duel,{...themes,bbox:{...themes.bbox,x0:1400,x1:1700}}],1800)).toBeUndefined();
    expect(findVsCaptureTitle("daily_totals", [{...duel,text:"DUFL"},themes],1800)).toBeUndefined();
    expect(findVsCaptureTitle("weekly_overview", [duel,themes],1800)).toBeUndefined();
  });

  it("reads the 3-0 weekly screenshot without inventing later winners", async () => {
    const candidate=await parseVsCaptureImage(readFileSync("src/lib/vs-performance/fixtures/vs-weekly-two-wins.png"),"weekly_overview");
    expect(candidate.left.server).toBe(1203);
    expect(candidate.right.server).toBe(1236);
    expect(candidate.leftPoints).toBe(3);
    expect(candidate.rightPoints).toBe(0);
    expect(candidate.dayResults.slice(2).every(day=>day.winner==="unknown")).toBe(true);
    expect(candidate.ongoing).toBe(true);
  },300_000);

  it("reads completed Day 2 totals without treating numbers or a player as alliance names", async () => {
    const candidate=await parseVsCaptureImage(readFileSync("src/lib/vs-performance/fixtures/vs-day-two-completed-redacted.png"),"daily_totals");
    expect(candidate.day).toBe(2);
    expect(candidate.leftScore).toBe("2241713380");
    expect(candidate.rightScore).toBe("2222858900");
    expect(candidate.left.name).toBeNull(); expect(candidate.right.name).toBeNull();
    expect(candidate.left.server).toBeNull(); expect(candidate.right.server).toBeNull();
  },300_000);
});

describe("parseVsCaptureImageAuto kind detection", () => {
  it("detects the completed Day 2 screenshot as daily with exact totals", async () => {
    const candidate = await parseVsCaptureImageAuto(readFileSync("src/lib/vs-performance/fixtures/vs-day-two-completed-redacted.png"));
    expect(candidate.kind).toBe("daily_totals");
    expect(candidate.day).toBe(2);
    expect(candidate.leftScore).toBe("2241713380");
    expect(candidate.rightScore).toBe("2222858900");
  }, 300_000);

  it("detects the original daily fixture as daily with 0/0", async () => {
    const candidate = await parseVsCaptureImageAuto(readFileSync(daily));
    expect(candidate.kind).toBe("daily_totals");
    expect(candidate.leftScore).toBe("0");
    expect(candidate.rightScore).toBe("0");
  }, 300_000);

  it("falls back to weekly only when real left-column day rows exist", async () => {
    const candidate = await parseVsCaptureImageAuto(readFileSync("src/lib/vs-performance/fixtures/vs-weekly-two-wins.png"));
    expect(candidate.kind).toBe("weekly_overview");
    expect(candidate.leftPoints).toBe(3);
    expect(candidate.rightPoints).toBe(0);
    expect(candidate.dayResults.slice(2).every(day => day.winner === "unknown")).toBe(true);
  }, 300_000);

  it("honors an explicit requested kind without probing", async () => {
    const candidate = await parseVsCaptureImageAuto(readFileSync(daily), "daily_totals");
    expect(candidate.kind).toBe("daily_totals");
  }, 300_000);

  it("reports a blank image as capture_kind_unknown", async () => {
    const sharp = (await import("sharp")).default;
    const blank = await sharp({ create: { width: 400, height: 1024, channels: 3, background: "#7d879f" } }).png().toBuffer();
    await expect(parseVsCaptureImageAuto(blank)).rejects.toMatchObject({ code: "capture_kind_unknown" });
  }, 300_000);
});
