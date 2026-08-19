# LastRank alliance page → HQ sync

**Status:** lab / first integration test  
**Source:** public HTML for one alliance, e.g. [LFgo](https://lastrank.fun/a/e7d1eaefdcfc42c8ac6c84247d2dad9b)

This is **not** scraping LastRank’s `/api/` (robots disallows it). We fetch the same HTML a browser gets. Member rows are already in the Next.js RSC payload (`public_id`, `name`, `power`, `hero_power`, `base_level`, `alliance_rank`). `public_id` is LastRank’s catalog id — **not** a Last War game UID.

Kills are **not** on the alliance page (only in the meta total). Skip kills until we have a game RPC or a cheaper path than 90+ player pages.

## Matching (LastRank name is canon)

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
| `hero_power` | THP (`lastrank_sync`) |
| `base_level` | HQ level (`lastrank_sync`) |
| `power` | `commanders.power_level` (e.g. `394.4M`) |

Canonical write is skipped when the commander has no `game_uid`, the lookup fails, or the API name does not exact-match LastRank. Stats still apply on the roster match.

Monotonic policy matches Ashed inbound: never auto-regress a protected self-report (`web` / `discord` / `screenshot_ocr` / `video_parse`). Conflicts are skipped (not queued on `/stat-sync`).

## Dry-run locally

Needs `LOCAL_DATABASE_URL` and a live LFgo roster in that DB.

```bash
npx tsx scripts/lastrank/sync-alliance.ts \
  --tag LFgo \
  --id e7d1eaefdcfc42c8ac6c84247d2dad9b
```

Interactive mapping for remaining unmatched names (requires a TTY):

```bash
npx tsx scripts/lastrank/sync-alliance.ts \
  --tag LFgo \
  --id e7d1eaefdcfc42c8ac6c84247d2dad9b \
  --interactive
```

`tsx` treats `import "server-only"` as a client import and throws unless the `react-server` export is used. The CLI registers `scripts/lastrank/register-server-only.cjs` (maps to `server-only/empty.js`). You can also run `npm run lastrank:sync -- --tag LFgo --id e7d1eaefdcfc42c8ac6c84247d2dad9b`.

`--apply` writes matches (stats + canonical when Last War confirms).

## Nightly

1. Set `LASTRANK_SYNC_MAP=LFgo=e7d1eaefdcfc42c8ac6c84247d2dad9b` in Vercel.
2. Cron `GET /api/internal/lastrank/sync` at 08:30 UTC (`vercel.json`) with `CRON_SECRET`.
3. Dry-run the deployed route with `?dryRun=1`.

Cloudflare may challenge datacenter IPs. If the cron starts returning challenge HTML, stop and go back to game-RPC capture.

## Do not

- Hit `https://lastrank.fun/api/`
- Treat LastRank `public_id` as `game_uid`
- Call lastwar.tools `/actions/*`
