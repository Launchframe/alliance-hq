import {
  findCptHedgeServerRecord,
  parseCptHedgeServerRecords,
} from "@/lib/game-season/parse-servers";
import type { CptHedgeServerRecord } from "@/lib/game-season/types";

const CPT_HEDGE_SERVERS_URL = "https://cpt-hedge.com/servers";
const CACHE_TTL_MS = 60 * 60 * 1000;

let cachedRecords: CptHedgeServerRecord[] | null = null;
let cachedAt = 0;

function chunkUrlFromHtml(html: string): string | null {
  const match = html.match(/\/_next\/static\/chunks\/6591-[a-f0-9]+\.js/);
  return match ? `https://cpt-hedge.com${match[0]}` : null;
}

async function fetchCptHedgePage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: "text/html,application/javascript,*/*" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`cpt-hedge fetch failed (${res.status})`);
  }
  return res.text();
}

export async function loadCptHedgeServerRecords(
  forceRefresh = false,
): Promise<CptHedgeServerRecord[]> {
  const now = Date.now();
  if (!forceRefresh && cachedRecords && now - cachedAt < CACHE_TTL_MS) {
    return cachedRecords;
  }

  const html = await fetchCptHedgePage(CPT_HEDGE_SERVERS_URL);
  let records = parseCptHedgeServerRecords(html);

  if (records.length === 0) {
    const chunkUrl = chunkUrlFromHtml(html);
    if (chunkUrl) {
      const chunk = await fetchCptHedgePage(chunkUrl);
      records = parseCptHedgeServerRecords(chunk);
    }
  }

  cachedRecords = records;
  cachedAt = now;
  return records;
}

export async function fetchCptHedgeServerRecord(
  serverNumber: number,
): Promise<CptHedgeServerRecord | null> {
  const records = await loadCptHedgeServerRecords();
  return findCptHedgeServerRecord(records, serverNumber);
}

/** Test helper — reset in-memory cache between tests. */
export function resetCptHedgeCacheForTests(): void {
  cachedRecords = null;
  cachedAt = 0;
}
