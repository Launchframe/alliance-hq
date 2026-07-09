import { describe, expect, it } from "vitest";

import { chunkUrlsFromHtml } from "@/lib/game-season/cpt-hedge";
import { parseCptHedgeServerRecords } from "@/lib/game-season/parse-servers";

describe("cpt-hedge chunk discovery", () => {
  it("extracts Next.js chunk URLs from the servers page HTML", () => {
    const html = `
      <script src="/_next/static/chunks/9668-62399a6af93c719d.js"></script>
      <script src="/_next/static/chunks/app/servers/page-4e13ad4af80826c6.js"></script>
    `;
    expect(chunkUrlsFromHtml(html)).toEqual(
      expect.arrayContaining([
        "https://cpt-hedge.com/_next/static/chunks/9668-62399a6af93c719d.js",
        "https://cpt-hedge.com/_next/static/chunks/app/servers/page-4e13ad4af80826c6.js",
      ]),
    );
  });

  it("parses server records from a modern cpt-hedge JS chunk blob", () => {
    const chunk =
      '{"id":"1203","server":"State#1203","timestamp":"1735204501000","currentSeason":5,"isPostSeason":false,"seasonStartTimestamps":{"s5":"1783303800000"},"currentWeek":1}';
    const records = parseCptHedgeServerRecords(chunk);
    expect(records[0]?.currentSeason).toBe(5);
  });
});
