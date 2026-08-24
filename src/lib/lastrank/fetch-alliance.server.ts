import "server-only";

import {
  lastRankAllianceUrl,
  parseLastRankAllianceHtml,
  type LastRankAlliancePage,
} from "@/lib/lastrank/alliance-page.shared";

const LAST_RANK_UA =
  "AllianceHQ-LastRankSync/0.1 (+https://frontline.gay; read-only alliance page)";

export async function fetchLastRankAlliancePage(
  lastrankAllianceId: string,
): Promise<LastRankAlliancePage> {
  const url = lastRankAllianceUrl(lastrankAllianceId);
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": LAST_RANK_UA,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const html = await response.text();
  if (!response.ok) {
    throw new Error(`LastRank HTTP ${response.status} for ${url}`);
  }
  return parseLastRankAllianceHtml(html, lastrankAllianceId);
}
