import { describe, expect, it, vi, afterEach } from "vitest";

import {
  chunkUrlsFromHtml,
  loadCptHedgeServerRecords,
  resetCptHedgeCacheForTests,
} from "@/lib/game-season/cpt-hedge";
import { parseCptHedgeServerRecords } from "@/lib/game-season/parse-servers";

describe("cpt-hedge chunk discovery", () => {
  afterEach(() => {
    resetCptHedgeCacheForTests();
    vi.unstubAllGlobals();
  });

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

  it("bypasses the in-memory cache when forceRefresh is true", async () => {
    const html =
      '<script src="/_next/static/chunks/app/servers/page-test.js"></script>';
    const season4Chunk =
      '{"id":"1203","server":"State#1203","timestamp":"1735204501000","currentSeason":4,"isPostSeason":false,"currentWeek":1}';
    const season5Chunk =
      '{"id":"1203","server":"State#1203","timestamp":"1735204501000","currentSeason":5,"isPostSeason":false,"currentWeek":1}';

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => html })
      .mockResolvedValueOnce({ ok: true, text: async () => season4Chunk })
      .mockResolvedValueOnce({ ok: true, text: async () => html })
      .mockResolvedValueOnce({ ok: true, text: async () => season5Chunk });

    vi.stubGlobal("fetch", fetchMock);

    const first = await loadCptHedgeServerRecords();
    expect(first[0]?.currentSeason).toBe(4);

    const refreshed = await loadCptHedgeServerRecords(true);
    expect(refreshed[0]?.currentSeason).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
