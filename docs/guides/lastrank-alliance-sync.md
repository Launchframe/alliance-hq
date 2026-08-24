# LastRank alliance page → HQ sync

**Status:** lab / first integration test  
**Source:** public HTML for one alliance, e.g. [LFgo](https://lastrank.fun/a/e7d1eaefdcfc42c8ac6c84247d2dad9b)

This is **not** scraping LastRank’s `/api/` (robots disallows it). We fetch the same HTML a browser gets. Member rows are already in the Next.js RSC payload (`public_id`, `name`, `power`, `hero_power`, `base_level`, `alliance_rank`). `public_id` is LastRank’s catalog id — **not** a Last War game UID.

Kills are **not** on the alliance page (only in the meta total). Skip kills until we have a game RPC or a cheaper path than 90+ player pages.

## Whitelist registry

Maintainer-curated mappings live in `src/lib/lastrank/sync-registry.shared.ts` (`LASTRANK_SYNC_REGISTRY`). Each entry is `[serverNumber] tag: lastrankAllianceId` — **tag may change; server number is stable**.

| Server | Tag | LastRank id |
| --- | --- | --- |
| 1203 | LFgo | `e7d1eaefdcfc42c8ac6c84247d2dad9b` |
| 1203 | BigD | `605b91e26dcc4e33b82d114b1846900c` |
| 1211 | Roar | `b1cf340c642947579ccbb753e7410c37` |
| 1203 | B1GG | `3eb55e69381b459db332262f187a7d9a` |
| 1203 | MOT0 | `4dfb6edfc33e4b2a935d0dbb70a42fe5` |
| 1203 | OMFG | `56467f87fc80423ba5faefd2c99f2976` |
| 1203 | TKW | `72ae5db534b34514917db77df889092e` |
| 1203 | S2BY | `ea191fe2028643b98c8fa541123e97d8` |
| 1203 | ChPs | `0689eb17f5234f8cbddcfe6d76351c14` |
| 1203 | Drtm | `b42f41e783084de5b0a5edb3020fa16c` |
| 1203 | KCaP | `5e5de3f03f644b60bcae81597e3fcc9b` |
| 1211 | bOoM | `9b495998c41d42a4a2fc38971e9c4b35` |
| 1211 | bOND | `806be0616a5544888e42e7a95b3fc16b` |
| 1211 | TFw | `81883dfc87b0490384cd0a24decd96cc` |
| 1211 | CuT3 | `dc5ce8fef23c408f9de64c6ea0eb96e3` |
| 1211 | KiLR | `703295dbb69d490887627fcf2d6c2918` |
| 1211 | RIsE | `c8e8098e9d0b49f49a6f57cb11b49315` |
| 1211 | 99BR | `3d74df8221cc464ea912d28fe6ddf358` |
| 1211 | XNES | `7b423cee715741198b578ec4c07d1280` |
| 1211 | MsFt | `03739bfcb6834511a294dfe1ef95d032` |

Generate a full cron `LASTRANK_SYNC_MAP` value from the registry:

```bash
node -e "import('./src/lib/lastrank/sync-registry.shared.ts').then(m=>console.log(m.formatLastRankSyncMapEnv()))"
```

## Matching (LastRank name is canon)

0. Stored `commanders.lastrank_public_id` when set
1. Exact match against HQ **current** names (roster `current_name`, commander `primary_name`, stored `canonical_name`)
2. Exact match against HQ **previous** names
3. Fuzzy match against current names (`stringSimilarity` ≥ 0.6, unique winner)
4. Fuzzy match against previous names
5. Still unmatched → CLI `--interactive` prompts for the HQ name to map

Cron / API never prompts; unmatched rows are skipped.

## What HQ writes

On each matched row (after auto or interactive mapping):

| LastRank field | HQ |
| --- | --- |
| `name` (canon) | `commanders.canonical_name` **only when** Last War lookup-by-UID `gameUserName` exact-matches the canon (`namesMatch`) |
| Section `R1`–`R5` badge | Appends `member_alliance_rank_events` (`source: lastrank_sync`) and updates `alliance_members` — overwrites when different. HQ-local only (no Ashed PUT). |
| `hero_power` | THP — **always upsert** from LastRank (`lastrank_sync`), including regressions |
| `base_level` | HQ level — **always upsert** from LastRank |
| `power` | `commanders.power_level` (e.g. `394.4M`) — **always upsert** when present |
| `public_id` | `commanders.lastrank_public_id` |
| `country` | `commanders.lastrank_country` — **always upsert** |
| profile URL | `commanders.lastrank_profile_url` (`https://lastrank.fun/p/{public_id}`) |

**Ranks:** collapsible HTML sections are headed by an exact `R1`–`R5` badge; every `/p/{publicId}` link in that section inherits that rank (preferred over the RSC `alliance_rank` field). Writes are HQ-local audit events (no Ashed PUT from this sync).

Canonical write is skipped when the commander has no `game_uid`, the lookup fails, or the API name does not exact-match LastRank. Stats still apply on the roster match.

LastRank is treated as source of truth for country, HQ level, base power, and THP on `--apply` — unlike Ashed inbound, there is **no** protected self-report monotonic gate for these fields.

### Upserts (`--apply`)

- **Alliance:** resolves HQ alliance by exact tag on server; fuzzy tag match prompts on `--interactive`; creates a native alliance when missing and `--apply` is set.
- **New LastRank members:** creates `alliance_members` + commander row + initial stats when no match remains after interactive mapping.
- **Retire leavers:** with `--apply --interactive`, prompts for each active HQ member missing from LastRank; marks `former` and prunes open train pools immediately on confirmation.
- **Interactive progress:** each manual name match is saved as you go — `lastrank_public_id` mapping always (even dry-run); full stats when `--apply` is set. Re-running skips already-mapped members via stored public id.
- **Create (`C`):** interactive prompt always offers `C` to create a new HQ member + commander from the LastRank row (needed for empty alliances). Unmatched rows left blank are skipped (not bulk-created).
- **`--create-all`:** with `--apply`, auto-create every remaining **unmatched** LastRank member (ambiguous rows still skipped). Use for populating a new/thin alliance:

```bash
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag BigD --apply --create-all
```

## Profile links from a power paste

Turn an officer paste list (`Name - 142M`, optional notes) into Markdown LastRank profile links. Fetches the live alliance HTML (no HQ DB write). Whitelisted `--server` + `--tag` (or `--id`); optional `--name` only labels the heading.

```bash
npx tsx scripts/lastrank/profile-links.ts --help
# paste list, then Ctrl-D:
npx tsx scripts/lastrank/profile-links.ts --server 1203 --tag BigD --name "Big Daddies"
# or from a file:
npx tsx scripts/lastrank/profile-links.ts --server 1203 --tag BigD --file list.txt
npm run lastrank:profile-links -- --server 1203 --tag BigD --file list.txt
```

Stdout is a Markdown bullet list of `[LastRank name](https://lastrank.fun/p/{public_id})`. Unmatched / ambiguous names go to stderr.

## Dry-run locally

Needs `LOCAL_DATABASE_URL` and a live roster in that DB (or an empty native alliance on the target server).

CLI flags (`--apply`, `--create-all`, `--interactive`, target options):

```bash
npx tsx scripts/lastrank/sync-alliance.ts --help
```

By whitelisted server + tag:

```bash
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo
```

Or by LastRank alliance id:

```bash
npx tsx scripts/lastrank/sync-alliance.ts --id e7d1eaefdcfc42c8ac6c84247d2dad9b
```

Interactive mapping for unmatched names, fuzzy alliance tag, and retire prompts (requires a TTY). The name prompt lists numbered HQ choices (fuzzy suggestions plus other unmatched roster names); reply with a **number**, a **typed HQ name**, or blank to skip:

```bash
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo --interactive
```

`tsx` treats `import "server-only"` as a client import and throws unless the `react-server` export is used. The CLI registers `scripts/lastrank/register-server-only.cjs` (maps to `server-only/empty.js`). You can also run `npm run lastrank:sync -- --server 1203 --tag LFgo`.

`--apply` writes matches (stats, ranks, profile fields, canonical when Last War confirms) and creates unmatched LastRank members.

## Nightly

1. Set `LASTRANK_SYNC_MAP` in Vercel (comma-separated `TAG=32charHex`; ids must exist in `LASTRANK_SYNC_REGISTRY` so server numbers resolve).
2. Cron `GET /api/internal/lastrank/sync` at 08:30 UTC (`vercel.json`) with `CRON_SECRET`.
3. Dry-run the deployed route with `?dryRun=1`.

Cloudflare may challenge datacenter IPs. If the cron starts returning challenge HTML, stop and go back to game-RPC capture.

## Do not

- Hit `https://lastrank.fun/api/`
- Treat LastRank `public_id` as `game_uid`
- Call lastwar.tools `/actions/*`
