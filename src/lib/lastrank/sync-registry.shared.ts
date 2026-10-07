import { isLastRankAllianceId } from "@/lib/lastrank/alliance-page.shared";

/** Known LastRank alliance — tag may change; server number is stable. */
export type LastRankSyncRegistryEntry = {
  gameServerNumber: number;
  tag: string;
  lastrankAllianceId: string;
  /** Officers may import this alliance from LastRank once self-service import ships. */
  selfServiceImport: boolean;
  /** Included in the nightly `/api/internal/lastrank/sync` cron. */
  autoSync: boolean;
};

/**
 * Maintainer-curated LastRank alliances. Gates self-service import eligibility and
 * the nightly auto-sync job only — the maintainer CLI can target any alliance.
 */
export const LASTRANK_SYNC_REGISTRY: readonly LastRankSyncRegistryEntry[] = [
  { gameServerNumber: 1203, tag: "LFgo", lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b", selfServiceImport: true, autoSync: true },
  { gameServerNumber: 1203, tag: "BigD", lastrankAllianceId: "605b91e26dcc4e33b82d114b1846900c", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "Roar", lastrankAllianceId: "b1cf340c642947579ccbb753e7410c37", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1203, tag: "B1GG", lastrankAllianceId: "3eb55e69381b459db332262f187a7d9a", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1203, tag: "MOT0", lastrankAllianceId: "4dfb6edfc33e4b2a935d0dbb70a42fe5", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1203, tag: "OMFG", lastrankAllianceId: "56467f87fc80423ba5faefd2c99f2976", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1203, tag: "TKW", lastrankAllianceId: "72ae5db534b34514917db77df889092e", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1203, tag: "S2BY", lastrankAllianceId: "ea191fe2028643b98c8fa541123e97d8", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1203, tag: "ChPs", lastrankAllianceId: "0689eb17f5234f8cbddcfe6d76351c14", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1203, tag: "Drtm", lastrankAllianceId: "b42f41e783084de5b0a5edb3020fa16c", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1203, tag: "KCaP", lastrankAllianceId: "5e5de3f03f644b60bcae81597e3fcc9b", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "bOoM", lastrankAllianceId: "9b495998c41d42a4a2fc38971e9c4b35", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "bOND", lastrankAllianceId: "806be0616a5544888e42e7a95b3fc16b", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "TFw", lastrankAllianceId: "81883dfc87b0490384cd0a24decd96cc", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "CuT3", lastrankAllianceId: "dc5ce8fef23c408f9de64c6ea0eb96e3", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "KiLR", lastrankAllianceId: "703295dbb69d490887627fcf2d6c2918", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "RIsE", lastrankAllianceId: "c8e8098e9d0b49f49a6f57cb11b49315", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "99BR", lastrankAllianceId: "3d74df8221cc464ea912d28fe6ddf358", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "XNES", lastrankAllianceId: "7b423cee715741198b578ec4c07d1280", selfServiceImport: true, autoSync: false },
  { gameServerNumber: 1211, tag: "MsFt", lastrankAllianceId: "03739bfcb6834511a294dfe1ef95d032", selfServiceImport: true, autoSync: false },
] as const;

export type LastRankSyncTarget = {
  gameServerNumber: number;
  tag: string;
  lastrankAllianceId: string;
};

function normalizeTag(tag: string): string {
  return tag.trim();
}

function toTarget(row: LastRankSyncRegistryEntry): LastRankSyncTarget {
  return {
    gameServerNumber: row.gameServerNumber,
    tag: row.tag,
    lastrankAllianceId: row.lastrankAllianceId,
  };
}

function findByServerAndTag(
  gameServerNumber: number,
  tag: string,
  entries: readonly LastRankSyncRegistryEntry[],
): LastRankSyncRegistryEntry | null {
  const needle = normalizeTag(tag).toLowerCase();
  const server = Math.floor(gameServerNumber);
  return (
    entries.find(
      (row) =>
        row.gameServerNumber === server && row.tag.toLowerCase() === needle,
    ) ?? null
  );
}

function findByAllianceId(
  lastrankAllianceId: string,
  entries: readonly LastRankSyncRegistryEntry[],
): LastRankSyncRegistryEntry | null {
  const needle = lastrankAllianceId.trim().toLowerCase();
  return (
    entries.find((row) => row.lastrankAllianceId.toLowerCase() === needle) ??
    null
  );
}

export function lookupLastRankSyncByServerAndTag(
  gameServerNumber: number,
  tag: string,
): LastRankSyncTarget | null {
  const row = findByServerAndTag(gameServerNumber, tag, LASTRANK_SYNC_REGISTRY);
  return row ? toTarget(row) : null;
}

export function lookupLastRankSyncByAllianceId(
  lastrankAllianceId: string,
): LastRankSyncTarget | null {
  const row = findByAllianceId(lastrankAllianceId, LASTRANK_SYNC_REGISTRY);
  return row ? toTarget(row) : null;
}

/** Whether officers may self-serve a LastRank import for this alliance. */
export function isLastRankSelfServiceImportAllowed(
  lastrankAllianceId: string,
  entries: readonly LastRankSyncRegistryEntry[] = LASTRANK_SYNC_REGISTRY,
): boolean {
  return findByAllianceId(lastrankAllianceId, entries)?.selfServiceImport ?? false;
}

/** Targets for the nightly cron (`autoSync: true`). */
export function listLastRankAutoSyncTargets(
  entries: readonly LastRankSyncRegistryEntry[] = LASTRANK_SYNC_REGISTRY,
): LastRankSyncTarget[] {
  return entries.filter((row) => row.autoSync).map(toTarget);
}

/**
 * Maintainer CLI target. Not gated by the registry: an unknown alliance just needs
 * `--id` plus `--server` and `--tag` (used to find or create the HQ alliance).
 * Explicit `--server`/`--tag` override registry metadata (tags can change).
 */
export function resolveLastRankSyncCliTarget(input: {
  lastrankAllianceId?: string;
  gameServerNumber?: number;
  tag?: string;
}): LastRankSyncTarget {
  const id = input.lastrankAllianceId?.trim().toLowerCase();
  const tag = input.tag?.trim() || undefined;
  const server =
    input.gameServerNumber != null && input.gameServerNumber > 0
      ? Math.floor(input.gameServerNumber)
      : undefined;

  if (id) {
    if (!isLastRankAllianceId(id)) {
      throw new Error(`Invalid LastRank alliance id "${id}"`);
    }
    const known = lookupLastRankSyncByAllianceId(id);
    const resolvedServer = server ?? known?.gameServerNumber;
    const resolvedTag = tag ?? known?.tag;
    if (resolvedServer != null && resolvedTag) {
      return {
        gameServerNumber: resolvedServer,
        tag: resolvedTag,
        lastrankAllianceId: id,
      };
    }
    throw new Error(
      `LastRank id ${id} is not in LASTRANK_SYNC_REGISTRY — also pass --server and --tag so HQ can find the alliance.`,
    );
  }

  if (tag && server != null) {
    const known = lookupLastRankSyncByServerAndTag(server, tag);
    if (known) return known;
    throw new Error(
      `No known LastRank id for server ${server} tag ${tag} — pass --id <lastrankAllianceId> (from https://lastrank.fun/a/<id>).`,
    );
  }

  throw new Error(
    "Pass --id <lastrankAllianceId> or both --server <number> and --tag <tag>.",
  );
}
