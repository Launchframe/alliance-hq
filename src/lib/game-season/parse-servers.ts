import type { CptHedgeServerRecord } from "@/lib/game-season/types";

/** Extract server records embedded in cpt-hedge.com /servers page or JS chunk. */
export function parseCptHedgeServerRecords(htmlOrJs: string): CptHedgeServerRecord[] {
  const records: CptHedgeServerRecord[] = [];
  const seen = new Set<string>();

  const objectPattern =
    /\{"id":"(\d+)","server":"[^"]*","timestamp":"(\d+)","currentSeason":(\d+),"isPostSeason":(true|false)[\s\S]*?"currentWeek":(\d+|null)/g;

  for (const match of htmlOrJs.matchAll(objectPattern)) {
    const id = match[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    records.push({
      id,
      timestampMs: Number.parseInt(match[2]!, 10),
      currentSeason: Number.parseInt(match[3]!, 10),
      isPostSeason: match[4] === "true",
      currentWeek: match[5] === "null" ? null : Number.parseInt(match[5]!, 10),
    });
  }

  return records;
}

export function findCptHedgeServerRecord(
  records: CptHedgeServerRecord[],
  serverNumber: number,
): CptHedgeServerRecord | null {
  const key = String(serverNumber);
  return records.find((row) => row.id === key) ?? null;
}
