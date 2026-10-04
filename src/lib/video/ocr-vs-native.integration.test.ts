import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import enUS from "../../../messages/en-US.json";
import ptBR from "../../../messages/pt-BR.json";
import { ocrVsNativeFrames } from "./ocr-vs-native";
import { terminateTesseractWorker } from "@/lib/members/roster-ocr/tesseract";

describe.skipIf(process.env.VS_NATIVE_OCR_TEST !== "1")("native VS image recognition", () => {
  afterAll(async () => { await terminateTesseractWorker(); });
  it.each(["en-US", "pt-BR"] as const)("reads a synthetic %s scoreboard with real Tesseract", async (locale) => {
    const messages = locale === "pt-BR" ? ptBR.videoReview : enUS.videoReview;
    const score = new Intl.NumberFormat(locale).format(7_200_000);
    const image = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="650"><rect width="1800" height="650" fill="white"/><g font-family="Arial" font-size="48" fill="black"><text x="70" y="100">${messages.colRank}</text><text x="270" y="100">${messages.colName}</text><text x="1100" y="100">${messages.colScore}</text><text x="70" y="240">1</text><text x="270" y="240">ALPHA</text><text x="1100" y="240">${score}</text><text x="70" y="380">2</text><text x="270" y="380">BRAVO</text><text x="1100" y="380">0</text></g></svg>`)).png().toBuffer();
    const result = await ocrVsNativeFrames([{ index: 0, buffer: image }]);
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "ALPHA", score: "7200000", rank: 1 }),
      expect.objectContaining({ name: "BRAVO", score: "0", rank: 2 }),
    ]));
  }, 60000);
});
