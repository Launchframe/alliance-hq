# LastRank alliance page → HQ sync

**Status:** lab / first integration test  
**Source:** public HTML for one alliance, e.g. [LFgo](https://lastrank.fun/a/e7d1eaefdcfc42c8ac6c84247d2dad9b)

This is **not** scraping LastRank’s `/api/` (robots disallows it). We fetch the same HTML a browser gets. Member rows are already in the Next.js RSC payload (`public_id`, `name`, `power`, `hero_power`, `base_level`, `alliance_rank`). `public_id` is LastRank’s catalog id — **not** a Last War game UID.

Kills are **not** on the alliance page (only in the meta total). Skip kills until we have a game RPC or a cheaper path than 90+ player pages.

## Registry

Maintainer-curated mappings live in `src/lib/lastrank/sync-registry.shared.ts` (`LASTRANK_SYNC_REGISTRY`). Each entry is `[serverNumber] tag: lastrankAllianceId` — **tag may change; server number is stable**.

The registry does **not** gate the maintainer CLI. It controls only:

| Flag | Effect |
| --- | --- |
| `selfServiceImport` | Officers may import this alliance from LastRank once self-service import ships (`isLastRankSelfServiceImportAllowed`). |
| `autoSync` | Included in the nightly cron (`listLastRankAutoSyncTargets`). |

The CLI uses the registry only as a shortcut: for a registered alliance, `--server` + `--tag` resolve the LastRank id (and `--id` resolves server + tag). For any other alliance, pass `--id` together with `--server` and `--tag`.

| Server | Tag | LastRank id | Auto-sync |
| --- | --- | --- | --- |
| 1203 | LFgo | `e7d1eaefdcfc42c8ac6c84247d2dad9b` | yes |
| 1203 | BigD | `605b91e26dcc4e33b82d114b1846900c` | |
| 1211 | Roar | `b1cf340c642947579ccbb753e7410c37` | |
| 1203 | B1GG | `3eb55e69381b459db332262f187a7d9a` | |
| 1203 | MOT0 | `4dfb6edfc33e4b2a935d0dbb70a42fe5` | |
| 1203 | OMFG | `56467f87fc80423ba5faefd2c99f2976` | |
| 1203 | TKW | `72ae5db534b34514917db77df889092e` | |
| 1203 | S2BY | `ea191fe2028643b98c8fa541123e97d8` | |
| 1203 | ChPs | `0689eb17f5234f8cbddcfe6d76351c14` | |
| 1203 | Drtm | `b42f41e783084de5b0a5edb3020fa16c` | |
| 1203 | KCaP | `5e5de3f03f644b60bcae81597e3fcc9b` | |
| 1211 | bOoM | `9b495998c41d42a4a2fc38971e9c4b35` | |
| 1211 | bOND | `806be0616a5544888e42e7a95b3fc16b` | |
| 1211 | TFw | `81883dfc87b0490384cd0a24decd96cc` | |
| 1211 | CuT3 | `dc5ce8fef23c408f9de64c6ea0eb96e3` | |
| 1211 | KiLR | `703295dbb69d490887627fcf2d6c2918` | |
| 1211 | RIsE | `c8e8098e9d0b49f49a6f57cb11b49315` | |
| 1211 | 99BR | `3d74df8221cc464ea912d28fe6ddf358` | |
| 1211 | XNES | `7b423cee715741198b578ec4c07d1280` | |
| 1211 | MsFt | `03739bfcb6834511a294dfe1ef95d032` | |

All current entries have `selfServiceImport: true`.

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
| Section `R1`–`R5` badge | Appends `member_alliance_rank_events` (`source: lastrank_sync`) and updates `alliance_members` — overwrites when different. When the member is in the credential's Ashed alliance, the rank is also PUT to Ashed (event gets `ashed_synced_at`) so the next Ashed roster pull does not revert it. |
| `hero_power` | THP — **always upsert** from LastRank (`lastrank_sync`), including regressions |
| `base_level` | HQ level — **always upsert** from LastRank |
| `power` | `commanders.power_level` (e.g. `394.4M`) — **always upsert** when present |
| `public_id` | `commanders.lastrank_public_id` |
| `country` | `commanders.lastrank_country` — **always upsert** |
| profile URL | `commanders.lastrank_profile_url` (`https://lastrank.fun/p/{public_id}`) |
| Profession (`career_type` / `⚔ WL · Nv 100` badge) | `commanders.profession` — see **Professions** below |
| Profession level (`career_lv` / `Nv`·`Lv` badge) | `commanders.professional_level` + `member_profession_level_events` — see **Professions** below |

**Professions:** LastRank can lag behind the game, so a recent HQ change wins over it:

| HQ profession | Result |
| --- | --- |
| Empty | Set from LastRank. |
| Same as LastRank | Unchanged; level applies only when LastRank's is higher (a lower LastRank level is reported, not written). |
| Different, changed in HQ within the last 7 days (`LASTRANK_PROFESSION_HQ_RECENT_DAYS`) | **Kept.** Reported as a conflict; level is not touched. |
| Different, older than 7 days or no recorded change | **Switched** to LastRank via `switchProfession` (`source: lastrank_sync`) — same as an HQ switch, so War Leader/Engineer pairings are torn down. LastRank's level replaces HQ's. |

"Changed in HQ" is the latest `profession_switched` event for the commander in `wl_team_events`.

**Ranks:** collapsible HTML sections are headed by an exact `R1`–`R5` badge; every `/p/{publicId}` link in that section inherits that rank (preferred over the RSC `alliance_rank` field). Rank changes are HQ audit events and, for Ashed-backed members with a usable credential (and no `--hq-only`), an Ashed rank PUT. Before this, Ashed's roster pull (every 24h or on officer refresh) overwrote LastRank ranks, and the nightly cron rewrote them. A failed PUT is logged and counted as `rankAshedFailed`; the HQ write stands.

Canonical write is skipped when the commander has no `game_uid`, the lookup fails, or the API name does not exact-match LastRank. Stats still apply on the roster match.

LastRank is treated as source of truth for country, HQ level, base power, and THP on `--apply` — unlike Ashed inbound, there is **no** protected self-report monotonic gate for these fields.

### Upserts (`--apply`)

- **Alliance:** resolves HQ alliance by exact tag on server; fuzzy tag match prompts on `--interactive`; creates a native alliance when missing and `--apply` is set.
- **New LastRank members:** creates `alliance_members` + commander row + initial stats when no match remains after interactive mapping.
- **Retire leavers:** with `--apply --interactive`, prompts for each active HQ member missing from LastRank; confirmed members are marked `former` (and open train pools pruned) in the batch write after the last prompt.
- **Interactive batch:** answers (maps, creates, retires) are queued in memory and written in one batch after the last prompt, so prompts do not wait on remote database round trips. After each answer the CLI prints running totals (`Queued: … — nothing written yet.`). The first Ctrl+C warns that queued answers will be lost; a second quits. Once writing starts, Ctrl+C likewise asks twice, since stopping then leaves a partial sync. Mapping writes `lastrank_public_id` always (even dry-run); with `--apply`, also HQ rename + previous names + canonical + Ashed name PUT when linked. Re-running skips already-mapped members via stored public id.
- **Create (`C`):** interactive prompt offers `C` to create a new HQ member + commander from a **ranked** LastRank row (needed for empty alliances). Hidden for unranked rows (often leavers). Requires `--apply` — dry-run mapping never creates members. Unmatched rows left blank are skipped (not bulk-created).
- **`--create-all`:** with `--apply`, auto-create every remaining **unmatched ranked** LastRank member (ambiguous and unranked rows still skipped). Use for populating a new/thin alliance:

```bash
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag BigD --apply --create-all
```

## Roster transfer (diff → create / retire)

LastRank is the roster source of truth after a member transfer. Dry-run prints a **roster diff** every time:

- **Excess in HQ** — active HQ members not on LastRank (too many in Ashed/HQ)
- **Missing from HQ** — LastRank names with no HQ match (forgot to add)
- **Ambiguous** — need `--interactive` mapping (not auto-created)

```bash
# See the diff (no writes)
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo

# Fix: create missing + retire excess (Ashed dual-write when bot JWT is stored)
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo \
  --ashed-connection-key "$ASHED_CONNECTION_KEY" \
  --apply --create-all --retire-all
```

`--create-all` / `--retire-all` require `--apply`. `--create-all` skips unranked LastRank rows (often leavers still listed). When the alliance is Ashed-linked and `alliance_ashed_credentials` (or `--ashed-connection-key`) is available, creates `POST` Ashed Members and retires `PUT` status `former` before HQ writes. Native / missing credential → HQ-only with a stderr note.

`--ashed-connection-key` must be an **Ashed owner** connection key (same owner gate as web/Discord `/link-ashed`). Collaborator keys are rejected. Refreshing an existing bot credential does not clear Discord/HQ registrant bindings.

**Cron does not create or retire** (Cloudflare may block LastRank HTML from Vercel). Use the local CLI for transfer waves.

## Profile links from a power paste

Turn an officer paste list (`Name - 142M`, optional notes) into Markdown LastRank profile links. Fetches the live alliance HTML (no HQ DB write). Registered `--server` + `--tag`, or `--id` (plus `--server` + `--tag` when unregistered); optional `--name` only labels the heading.

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

By registered server + tag:

```bash
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo
```

Or by LastRank alliance id (registered):

```bash
npx tsx scripts/lastrank/sync-alliance.ts --id e7d1eaefdcfc42c8ac6c84247d2dad9b
```

Any other alliance — take the id from `https://lastrank.fun/a/<id>`; server + tag find (or with `--apply`, create) the HQ alliance:

```bash
npx tsx scripts/lastrank/sync-alliance.ts --id <32charHex> --server 1300 --tag NeW
```

Interactive mapping for unmatched names, fuzzy alliance tag, and retire prompts (requires a TTY). Each “No auto-match” prompt prints the LastRank profile URL (`https://lastrank.fun/p/<public_id>`). Unranked LastRank rows (not in an R1–R5 section) get a leaver hint — leave blank to skip; do not create.

The name prompt lists numbered HQ choices (suggestions plus other unmatched roster names); reply with a **number**, a **typed HQ name**, **`C`** to create (hidden for unranked), or blank to skip.

Suggestions are ranked by a weighted score so renamed members still surface: name similarity (0.40), THP within ±15% (0.35), same country (0.15), and same profession / profession level (0.05 each — a tiebreaker, since most of the alliance shares them at the level-100 cap). Signals either side lacks are left out of the score. Each suggestion shows its breakdown, e.g. `(score 0.58: name 0.00, THP ±1.0%, same country, same profession, same profession level)`. Suggestions never auto-match.

```bash
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo --interactive
```

Persistence:

- **Always (even without `--apply`):** a number/name answer writes (in the batch after the last prompt) `commanders.lastrank_public_id` (+ profile URL/country). The next run auto-matches that member via public id — you are not re-prompted for the same LastRank row.
- **With `--apply`:** also renames `alliance_members.current_name` to the LastRank canon, appends the prior HQ name to `previous_names_json`, sets `commanders.canonical_name`, and dual-writes Ashed `current_name` / `previous_names` when the alliance has a bot credential (unless `--hq-only`).

`tsx` treats `import "server-only"` as a client import and throws unless the `react-server` export is used. The CLI registers `scripts/lastrank/register-server-only.cjs` (maps to `server-only/empty.js`). You can also run `npm run lastrank:sync -- --server 1203 --tag LFgo`.

`--apply` writes matches (stats, ranks, profile fields, interactive renames above, and canonical via Last War confirm for auto-matches) and creates unmatched LastRank members when requested. `--apply` alone never creates members — on a new or empty alliance every LastRank row is unmatched, so add `--create-all` (or `--interactive` and `C`). The CLI warns when an `--apply` run leaves unmatched members uncreated.

## Target database

The CLI resolves the database the same way as the app: `LOCAL_DATABASE_URL` wins whenever set, otherwise `DATABASE_URL`. Every run prints the resolved host first (`Database: <host> (local|REMOTE)`).

Any run that writes (`--apply`, `--interactive`, `--save-ashed-credential`) against a non-localhost database must pass `--confirm-host <host>` equal to that printed host; otherwise it exits before touching the database. A mismatched `--confirm-host` always fails.

Production runs:

1. Rehearse on a Neon child branch of production with `--hq-only` (a branch's saved Ashed credentials are real).
2. Take a fresh Neon branch of production as a restore point right before writing.
3. Override the URL for one command — `LOCAL_DATABASE_URL` must be empty or it wins:

```bash
# Dry-run: note the printed host
LOCAL_DATABASE_URL= DATABASE_URL='<prod url>' npx tsx scripts/lastrank/sync-alliance.ts --id <id> --server <n> --tag <tag>

# Write
LOCAL_DATABASE_URL= DATABASE_URL='<prod url>' npx tsx scripts/lastrank/sync-alliance.ts --id <id> --server <n> --tag <tag> \
  --apply --interactive --confirm-host <printed host>
```

A local run against production can write HQ rows but **cannot use the saved Ashed credential** unless your `TOKEN_ENCRYPTION_KEY` matches production's. Do not "fix" that with `--ashed-connection-key`: it re-encrypts the credential with your local key and breaks it for production. Use remote mode instead.

### Remote mode (`--remote`)

Runs the plan and the writes on a deployed HQ, so production's database, encryption key, and saved Ashed credential are used. Only the prompts run on your machine.

Setup, once per environment:

1. Generate a token: `openssl rand -hex 32` (at least 32 characters; shorter values are treated as unset).
2. Add it to Vercel as `LASTRANK_SYNC_TOKEN` (Production) and redeploy.
3. Export the same value locally as `LASTRANK_SYNC_TOKEN`. The CLI reads it from the environment only — never pass it as a flag.

```bash
export LASTRANK_SYNC_TOKEN=...   # same value as Vercel

# Plan only (no writes): prints the roster diff and how many prompts are waiting
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo --remote https://<hq origin>

# Answer prompts locally, then the server writes everything in one batch
npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo --remote https://<hq origin> \
  --apply --interactive
```

- Endpoints: `POST /api/internal/lastrank/remote-sync/plan` and `/apply`. They accept only `Authorization: Bearer $LASTRANK_SYNC_TOKEN`; session cookies (even platform maintainer) are rejected. Unset token → every request is 403.
- The alliance must already exist in HQ; remote mode never creates alliances. If the alliance resolved by apply differs from the plan, apply aborts before writing.
- `--create-all`, `--retire-all`, and `--hq-only` work as locally. `--ashed-connection-key` and `--save-ashed-credential` are rejected.
- Mappings that no longer match on the server (an HQ name changed between plan and apply) are listed after apply and not written.
- The server also fetches LastRank HTML, so a Cloudflare challenge against Vercel IPs breaks remote mode the same way it would break the cron.

## Nightly

1. Set `autoSync: true` on the registry entries to sync (no env var; `LASTRANK_SYNC_MAP` is no longer read).
2. Cron `GET /api/internal/lastrank/sync` at 08:30 UTC (`vercel.json`) with `CRON_SECRET`.
3. Dry-run the deployed route with `?dryRun=1`.

Cloudflare may challenge datacenter IPs. If the cron starts returning challenge HTML, stop and go back to game-RPC capture.

## Do not

- Hit `https://lastrank.fun/api/`
- Treat LastRank `public_id` as `game_uid`
- Call lastwar.tools `/actions/*`
