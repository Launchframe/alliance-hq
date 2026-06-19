import { describe, expect, it } from "vitest";

import {
  findCptHedgeServerRecord,
  parseCptHedgeServerRecords,
} from "@/lib/game-season/parse-servers";

const SERVER_1203_SNIPPET =
  '{"id":"1203","server":"State#1203","timestamp":"1735204501000","currentSeason":4,"isPostSeason":true,"seasonStartTimestamps":{"s2":"1754301600000","s3":"1763373600000","s4":"1773050400000"},"currentWeek":7,"updatedAt":1777907014381,"region":["korea","north america","south america"]}';

describe("parseCptHedgeServerRecords", () => {
  it("extracts server 1203 from embedded blob", () => {
    const records = parseCptHedgeServerRecords(SERVER_1203_SNIPPET);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "1203",
      timestampMs: 1735204501000,
      currentSeason: 4,
      isPostSeason: true,
      currentWeek: 7,
    });
  });

  it("finds record by server number", () => {
    const records = parseCptHedgeServerRecords(SERVER_1203_SNIPPET);
    expect(findCptHedgeServerRecord(records, 1203)?.currentSeason).toBe(4);
    expect(findCptHedgeServerRecord(records, 999)).toBeNull();
  });
});
