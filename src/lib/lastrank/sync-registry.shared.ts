import {
  isLastRankAllianceId,
  parseLastRankSyncMap,
} from "@/lib/lastrank/alliance-page.shared";

/** Whitelisted LastRank alliance — tag may change; server number is stable. */
export type LastRankSyncRegistryEntry = {
  gameServerNumber: number;
  tag: string;
  lastrankAllianceId: string;
};

/**
 * Maintainer-curated whitelist for LastRank → HQ sync (CLI + cron env).
 * Format: `[server] tag: lastrankAllianceId`
 */
export const LASTRANK_SYNC_REGISTRY: readonly LastRankSyncRegistryEntry[] = [
  { gameServerNumber: 1203, tag: "LFgo", lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b" },
  { gameServerNumber: 1203, tag: "BigD", lastrankAllianceId: "605b91e26dcc4e33b82d114b1846900c" },
  { gameServerNumber: 1211, tag: "Roar", lastrankAllianceId: "b1cf340c642947579ccbb753e7410c37" },
  { gameServerNumber: 1203, tag: "B1GG", lastrankAllianceId: "3eb55e69381b459db332262f187a7d9a" },
  { gameServerNumber: 1203, tag: "MOT0", lastrankAllianceId: "4dfb6edfc33e4b2a935d0dbb70a42fe5" },
  { gameServerNumber: 1203, tag: "OMFG", lastrankAllianceId: "56467f87fc80423ba5faefd2c99f2976" },
  { gameServerNumber: 1203, tag: "TKW", lastrankAllianceId: "72ae5db534b34514917db77df889092e" },
  { gameServerNumber: 1203, tag: "S2BY", lastrankAllianceId: "ea191fe2028643b98c8fa541123e97d8" },
  { gameServerNumber: 1203, tag: "ChPs", lastrankAllianceId: "0689eb17f5234f8cbddcfe6d76351c14" },
  { gameServerNumber: 1203, tag: "Drtm", lastrankAllianceId: "b42f41e783084de5b0a5edb3020fa16c" },
  { gameServerNumber: 1203, tag: "KCaP", lastrankAllianceId: "5e5de3f03f644b60bcae81597e3fcc9b" },
  { gameServerNumber: 1211, tag: "bOoM", lastrankAllianceId: "9b495998c41d42a4a2fc38971e9c4b35" },
  { gameServerNumber: 1211, tag: "bOND", lastrankAllianceId: "806be0616a5544888e42e7a95b3fc16b" },
  { gameServerNumber: 1211, tag: "TFw", lastrankAllianceId: "81883dfc87b0490384cd0a24decd96cc" },
  { gameServerNumber: 1211, tag: "CuT3", lastrankAllianceId: "dc5ce8fef23c408f9de64c6ea0eb96e3" },
  { gameServerNumber: 1211, tag: "KiLR", lastrankAllianceId: "703295dbb69d490887627fcf2d6c2918" },
  { gameServerNumber: 1211, tag: "RIsE", lastrankAllianceId: "c8e8098e9d0b49f49a6f57cb11b49315" },
  { gameServerNumber: 1211, tag: "99BR", lastrankAllianceId: "3d74df8221cc464ea912d28fe6ddf358" },
  { gameServerNumber: 1211, tag: "XNES", lastrankAllianceId: "7b423cee715741198b578ec4c07d1280" },
  { gameServerNumber: 1211, tag: "MsFt", lastrankAllianceId: "03739bfcb6834511a294dfe1ef95d032" },
] as const;

export type LastRankSyncTarget = {
  gameServerNumber: number;
  tag: string;
  lastrankAllianceId: string;
};

function normalizeTag(tag: string): string {
  return tag.trim();
}

export function lookupLastRankSyncByServerAndTag(
  gameServerNumber: number,
  tag: string,
): LastRankSyncTarget | null {
  const needle = normalizeTag(tag).toLowerCase();
  const server = Math.floor(gameServerNumber);
  for (const row of LASTRANK_SYNC_REGISTRY) {
    if (
      row.gameServerNumber === server &&
      row.tag.toLowerCase() === needle
    ) {
      return { ...row };
    }
  }
  return null;
}

export function lookupLastRankSyncByAllianceId(
  lastrankAllianceId: string,
): LastRankSyncTarget | null {
  const needle = lastrankAllianceId.trim().toLowerCase();
  for (const row of LASTRANK_SYNC_REGISTRY) {
    if (row.lastrankAllianceId.toLowerCase() === needle) {
      return { ...row };
    }
  }
  return null;
}

/** Comma-separated `TAG=hex` for `LASTRANK_SYNC_MAP` (cron). */
export function formatLastRankSyncMapEnv(
  entries: readonly LastRankSyncRegistryEntry[] = LASTRANK_SYNC_REGISTRY,
): string {
  return entries
    .map((row) => `${row.tag}=${row.lastrankAllianceId}`)
    .join(",");
}

export function resolveLastRankSyncCliTarget(input: {
  lastrankAllianceId?: string;
  gameServerNumber?: number;
  tag?: string;
}): LastRankSyncTarget {
  const id = input.lastrankAllianceId?.trim().toLowerCase();
  const tag = input.tag?.trim();
  const server =
    input.gameServerNumber != null
      ? Math.floor(input.gameServerNumber)
      : undefined;

  if (id) {
    if (!isLastRankAllianceId(id)) {
      throw new Error(`Invalid LastRank alliance id "${id}"`);
    }
    const fromRegistry = lookupLastRankSyncByAllianceId(id);
    if (fromRegistry) return fromRegistry;
    if (tag && server != null && server > 0) {
      return { gameServerNumber: server, tag, lastrankAllianceId: id };
    }
    throw new Error(
      `LastRank id ${id} is not in the whitelist registry — pass --server and --tag, or add it to LASTRANK_SYNC_REGISTRY.`,
    );
  }

  if (tag && server != null && server > 0) {
    const fromRegistry = lookupLastRankSyncByServerAndTag(server, tag);
    if (fromRegistry) return fromRegistry;
    throw new Error(
      `No whitelisted LastRank mapping for server ${server} tag ${tag}.`,
    );
  }

  throw new Error(
    "Pass --id <lastrankAllianceId> or both --server <number> and --tag <tag>.",
  );
}

/** Cron/env map entries enriched with server number from the whitelist registry. */
export function resolveLastRankSyncMapTargets(
  raw: string | undefined,
): LastRankSyncTarget[] {
  const parsed = parseLastRankSyncMap(raw);
  const out: LastRankSyncTarget[] = [];
  for (const row of parsed) {
    const fromRegistry = lookupLastRankSyncByAllianceId(row.lastrankAllianceId);
    if (fromRegistry) {
      out.push(fromRegistry);
      continue;
    }
    throw new Error(
      `LASTRANK_SYNC_MAP entry ${row.tag}=${row.lastrankAllianceId} is not in LASTRANK_SYNC_REGISTRY — add server metadata to the registry first.`,
    );
  }
  return out;
}
