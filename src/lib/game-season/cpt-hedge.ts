import {
  findCptHedgeServerRecord,
  parseCptHedgeServerRecords,
} from "@/lib/game-season/parse-servers";
import type { CptHedgeServerRecord } from "@/lib/game-season/types";

const CPT_HEDGE_SERVERS_URL = "https://cpt-hedge.com/servers";
const CACHE_TTL_MS = 60 * 60 * 1000;

let cachedRecords: CptHedgeServerRecord[] | null = null;
let cachedAt = 0;

/** Next.js chunk URLs referenced from the /servers page. */
export function chunkUrlsFromHtml(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/\/_next\/static\/chunks\/[^\s"']+\.js/g)) {
    const path = match[0]!;
    if (seen.has(path)) continue;
    seen.add(path);
    urls.push(`https://cpt-hedge.com${path}`);
  }
  return urls;
}

let cachedChunkUrl: string | null = null;

async function loadRecordsFromChunks(
  html: string,
  fetchPage: (url: string) => Promise<string>,
): Promise<CptHedgeServerRecord[]> {
  const urls: string[] = [];
  if (cachedChunkUrl) urls.push(cachedChunkUrl);
  for (const url of chunkUrlsFromHtml(html)) {
    if (!urls.includes(url)) urls.push(url);
  }

  for (const url of urls) {
    try {
      const chunk = await fetchPage(url);
      const records = parseCptHedgeServerRecords(chunk);
      if (records.length > 0) {
        cachedChunkUrl = url;
        return records;
      }
    } catch {
      // try the next chunk
    }
  }

  return [];
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

  if (forceRefresh) {
    cachedChunkUrl = null;
  }

  const html = await fetchCptHedgePage(CPT_HEDGE_SERVERS_URL);
  let records = parseCptHedgeServerRecords(html);

  if (records.length === 0) {
    records = await loadRecordsFromChunks(html, fetchCptHedgePage);
  }

  cachedRecords = records;
  cachedAt = now;
  return records;
}

export async function fetchCptHedgeServerRecord(
  serverNumber: number,
  forceRefresh = false,
): Promise<CptHedgeServerRecord | null> {
  const records = await loadCptHedgeServerRecords(forceRefresh);
  return findCptHedgeServerRecord(records, serverNumber);
}

/** Test helper — reset in-memory cache between tests. */
export function resetCptHedgeCacheForTests(): void {
  cachedRecords = null;
  cachedAt = 0;
  cachedChunkUrl = null;
}
