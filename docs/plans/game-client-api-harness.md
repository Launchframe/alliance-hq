# Game client API harness — plan

**Status:** draft (design only — no implementation yet)  
**Goal:** Replace (or sharply reduce) expensive/unreliable OCR of in-game scoreboards by reading the same HTTP(S) APIs the official client uses, via a **read-only** harness that officers operate on a schedule.

**Non-goals (v1):** Playing the game, sending marches, chat, purchases, or any write that mutates world/player state beyond what opening a scoreboard UI already triggers.

---

## Why this exists

Today Alliance HQ ingests event/recurring scores mainly by:

1. Officer films or screenshots in-game boards  
2. Video/still OCR (`SCORE_TARGETS` in `src/lib/video/score-targets.ts`)  
3. Officer review → submit into Ashed entities and/or HQ-native tables  

Identity already hits a **public Last War platform** endpoint (`src/lib/lastwar/player-lookup.ts` → `redemptionCode.php?method=login&uid=…`). That path is **not** a scoreboard API and must not be confused with live client traffic.

This plan is the Ashed-HAR playbook applied to the **game client**: capture → sanitize → catalog → thin client → ingest into existing sinks.

---

## ToS / risk posture (explicit)

Last War’s ToS language around “bots” typically targets **automated play** (replacing a human in PvP/PvE). A **read-only observer** that only fetches leaderboard/roster payloads the client already loads is a different risk class — but it is still **unauthorized automation** relative to the publisher unless they grant API access.

Treat this as:

| Principle | Practice |
| --- | --- |
| Read-only | Never POST actions that move troops, spend resources, claim rewards, or mutate alliance state |
| Client-identical | Same host, path, method, headers, body framing, TLS fingerprinting where practical |
| Human-paced | Match officer cadence (e.g. once after VS day close), not high-frequency polling |
| Account hygiene | Dedicated “harness” commander account preferred; never share session tokens in git/logs |
| Kill switch | Immediate stop if publisher signals (401 patterns, ToS mail, unusual CAPTCHA) |
| No product marketing as “official API” | Internal ops tool; keep out of public docs until legal comfort is clear |

**Legal note:** This doc is an engineering plan, not legal advice. Maintainer should decide go/no-go before any production multi-tenant use.

---

## Current data map (what we’d replace)

| Score / data | Primary ingest today | Likely harness target |
| --- | --- | --- |
| Desert / Canyon / Zombie / Alliance Exercise | Video OCR → Ashed score entities | Event scoreboard APIs |
| VS daily / weekly | Video OCR → `bulkUpsertVSScores` / `VSScore` | VS ranking APIs (Mon–Sat ST) |
| Donations | Video OCR → `Donation` | Alliance donation board API |
| Alliance kills board | Video OCR → `KillScore` | Strength / kills ranking API |
| Seasonal / Frontline | Video OCR → `SeasonalScore` | Seasonal board APIs |
| Member roster | Video/still OCR or Ashed sync | Alliance member list API |
| Bank City List / deposit slips | Still/video OCR → HQ banks | Inventory / deposit history APIs (if exposed) |
| VR | Self-report / officer override (HQ-only) | Only if client exposes base VR separately from skills |
| THP / personal kills | Self-report + screenshot OCR | Personal power/kills detail APIs |
| Train ritual state | Officer lock in HQ | Unchanged (not a scoreboard scrape) |

**Design rule:** Harness output should land in the **same review/submit or dual-write paths** OCR already uses (`submit-dispatch`, batch ledger, HQ VR/THP/kills tables). Do not invent a parallel score store.

---

## Phase 0 — Capture lab (BlueStacks + SmartFox TCP)

You run the game on **BlueStacks on Mac**. Login is **not** HTTPS — it is encrypted SmartFox TCP (`e405` mobile / `e406` PC) to the game relay (often `172.65.210.24:18349`). That is the same shape [LastWarTools/Capture-Tool](https://github.com/LastWarTools/Capture-Tool) already sniffs.

**Preferred path:** compile/run our Mac fork in [`tools/lastwar-capture/`](../../tools/lastwar-capture/) (GPLv3), watch BlueStacks NAT traffic on `en0`, upload `handshake.bin` / `auth.bin` / `login.bin` to `api.lastwar.tools`, then call read-only VS endpoints. Operator guide: [`docs/guides/lastwar-tools-bluestacks-capture.md`](../guides/lastwar-tools-bluestacks-capture.md).

### Recommended stack (Mac)

1. **Host sniffer** — `tools/lastwar-capture/capture_cli.py` (scapy + libpcap, run with `sudo`)  
2. **BlueStacks** — force-quit game → start capture → relaunch + login  
3. **API** — [lastwar.tools](https://lastwar.tools/) API key + session key (`scripts/lastwar-tools/`)  
4. **Fallback** — Frida hook inside the guest (`frida_capture_bluestacks.js`) if host sniffing is blind  
5. **Optional later** — mitmproxy only if we discover separate HTTPS scoreboard APIs; login itself does not need TLS intercept  

### Capture protocol (login → VS)

1. Capture login triple (handshake / auth / login) via CLI  
2. `POST /auth/credentials/upload` → `GET /auth/sessions` → `session_key`  
3. `GET /vs/rankings/daily?day=1..6` (Mon–Sat) via `scripts/lastwar-tools/fetch-vs-daily.mjs`  
4. Filter by `alliance_abbr`; keep UIDs off shared surfaces  

Capture matrix (API whitelist — read-only):

- Login / session (`/auth/*`)  
- VS daily + season (`/vs/rankings/*`)  
- VS schedule / matchups / group  
- Alliance members  
- Defer write endpoints under `/actions/*` forever for HQ automation  

### Hard technical risks to expect

| Risk | Symptom | Mitigation direction |
| --- | --- | --- |
| **Wrong iface on Mac** | Zero `e405` packets | `list-ifaces`; try `en0` / bridge; reboot BlueStacks |
| **Capture after login** | Stuck waiting | Force-quit game, start sniffer, then launch |
| **Host sniff blind** | Only see unrelated TCP | Frida `send()` hook in guest; pull `.bin` via adb |
| **Session expiry** | 401 from lastwar.tools | Re-capture login blobs; refresh session_key |
| **Third-party dependency** | lastwar.tools down / ToS | Keep blobs local; long-term optional self-hosted replay |
| **Server-time alignment** | Wrong VS day | Day `1–6` = Mon–Sat ST; see `.cursor/rules/alliance-affairs.mdc` |

### Success criteria for Phase 0

- [ ] Mac CLI captures handshake + auth + login from BlueStacks traffic (or Frida fallback)  
- [ ] Upload accepted by `api.lastwar.tools`  
- [ ] `fetch-vs-daily.mjs --day 1` returns alliance rows for a known VS Monday  
- [ ] UIDs redacted in shared output  

---

## Phase 1 — Protocol catalog (repo artifact)

Mirror the Ashed workflow (`har/*.har` gitignored → `npm run har:catalog` → `docs/ashed-api-catalog.json`).

Proposed layout:

```
captures/lastwar/          # gitignored raw HAR / mitm flows
scripts/lastwar-har/       # extract + redact + catalog
docs/lastwar-api-catalog.json   # sanitized endpoint index (committed)
docs/plans/game-client-api-harness.md  # this plan
```

Catalog entry shape (draft):

```json
{
  "id": "vs-daily-ranking",
  "host": "…",
  "method": "POST",
  "path": "/…",
  "contentType": "application/json",
  "auth": ["session-header", "device-id"],
  "pagination": "offset|cursor|none",
  "responseShape": { "members": [{ "name": "string", "score": "number", "rank": "number" }] },
  "mapsToScoreTarget": "vs-performance",
  "capturedAt": "2026-…",
  "notes": "Opened from Alliance → VS → Daily"
}
```

**Redaction rules:** strip auth tokens, cookies, `game_uid`, device IDs from committed catalog; keep field *names* and structural examples with fake values. Same privacy bar as `player-uid-privacy.mdc`.

---

## Phase 2 — Local harness (CLI / small service)

A **local** process first (your Mac / a locked-down VM), not a multi-tenant cloud scraper.

### Responsibilities

1. **Session** — Interactive or config-based login that obtains the same session material the client uses (from Phase 0 templates). Prefer operator pastes session from a fresh capture over storing passwords long-term.  
2. **Fetchers** — One module per catalog id; returns normalized rows `{ externalMemberId?, name, score, rank?, boardMeta }`.  
3. **Fidelity layer** — Shared HTTP client that applies recorded headers, TLS options, pacing (jittered delays), and User-Agent / client version strings from capture.  
4. **Dry-run** — Dump JSON to disk; diff against a same-day OCR export for the same board.  
5. **Schedule** — cron/launchd on the lab machine: e.g. VS daily shortly after day rollover ST; weekly after Sunday ST window officers already use.

### Architecture sketch

```
BlueStacks (human login, optional)
        │
        ▼
[ optional: export session once ]
        │
        ▼
lastwar-harness (local)
  ├── session/
  ├── http/client-identical.ts
  ├── fetchers/vs-daily.ts
  ├── fetchers/…
  └── normalize/ → ScoreIngestBatch
        │
        ▼
Alliance HQ ingest (Phase 3)
  review queue OR trusted auto-submit
```

### Client-identical checklist

- Method + path + query order  
- Content-Type and body field order if the server is picky  
- Auth + device headers from capture  
- Accept-Language / client version  
- Connection reuse patterns if observed  
- Rate: ≤ human officer open rate (start at 1 board / few minutes)

### Explicit bans in harness code

- No combat, march, gather, or shop endpoints registered  
- Allowlist of catalog ids only (deny-by-default, same spirit as BFF catalog)  
- No default cloud deploy; local-only until Phase 4 review  

---

## Phase 3 — HQ integration

Wire harness batches into existing product surfaces:

| Step | Approach |
| --- | --- |
| Auth to HQ | Officer session or internal token scoped to one alliance |
| Ingest API | New `POST /api/tools/game-sync/ingest` (name TBD) that accepts normalized batches and reuses `submit-dispatch` / HQ event writers |
| Review UX | Default: land in same review UI as video jobs (`source: game_api`) so officers still confirm names |
| Idempotency | Batch ledger (`data_upload_batches`) with source `game_client_api` |
| Mapping | `mapsToScoreTarget` → existing `SCORE_TARGETS` ids |
| Member match | Prefer stable game member id from API if present; else exact name match against `alliance_members` (same strictness as member-link — no fuzzy merge of identity) |
| Observability | Job rows, duration, row counts, mismatch vs last OCR run |

**VR / THP / kills:** only auto-write when the API field is unambiguously the same metric HQ stores (base VR multiples of 250, etc.). Otherwise keep self-report + screenshot paths.

**Ashed dual-write:** keep current sync rules (`hq-ashed-dual-write-sync`); harness should not bypass monotonic guards.

---

## Phase 4 — Hardening & multi-tenant (only if Phase 0–3 prove out)

- Per-alliance credential vault (encrypted), similar to `alliance_ashed_credentials`  
- Never accept game passwords in Discord slash commands (same nonce + HTTPS form pattern as `/link-ashed`)  
- Feature flag / allowlist tags  
- Automatic backoff on 429/403  
- Contract tests against recorded fixtures (like `src/tests/fixtures/lastwar/`)  
- Gradual OCR deprecation per `SCORE_TARGET` when harness accuracy ≥ review acceptance rate  

Defer until captures show stable, documentable HTTP APIs and maintainer accepts residual ToS risk.

---

## Suggested milestones

| Milestone | Deliverable | Exit check |
| --- | --- | --- |
| **M0** | Capture lab running; pinning assessed | One decrypted scoreboard HAR |
| **M1** | Catalog script + `docs/lastwar-api-catalog.json` stub | 3+ endpoints documented |
| **M2** | Local harness dry-run for VS daily | JSON matches OCR export within tolerance |
| **M3** | HQ ingest + review source `game_api` | Officer can accept a harness batch in UI |
| **M4** | Scheduled local cron for VS + donations | One week without OCR for those boards |
| **M5** | Optional vaulted multi-tenant | Explicit go/no-go |

---

## Immediate next actions (you + lab)

1. Get a lastwar.tools API key; install `tools/lastwar-capture` deps on the Mac (`brew install libpcap`, venv, `pip install -r requirements.txt`).  
2. Run `sudo -E python capture_cli.py capture --iface en0 --out ./creds --api-key "$LWT_API_KEY"` and log in via BlueStacks.  
3. `node scripts/lastwar-tools/list-sessions.mjs` then `fetch-vs-daily.mjs --day 1 --alliance-tag …`.  
4. If host sniff fails, use Frida path in `tools/lastwar-capture/README.md`.  
5. Decide go/no-go on ToS / third-party dependency before any shared hosting.

---

## Appendix A — Relationship to existing Last War HTTP

| Endpoint / area | Role today | Role in harness |
| --- | --- | --- |
| `lastwar-platform.lastwargame.com/redemptionCode.php?method=login` | Public name/level/avatar/server by UID | Keep for member-link only; do **not** treat as scoreboard |
| `lastwar-h5.lastwargame.com` | Avatar base URL | Unrelated to rankings |
| In-game client hosts (unknown until M0) | — | Primary harness surface |

## Appendix B — Open questions

1. Does the Android build pin certificates on BlueStacks?  
2. Are ranking payloads JSON or protobuf?  
3. Is pagination offset-based or cursor-based for long alliances?  
4. Does the client expose **base** VR, or only effective VR with skills?  
5. Can one R5 account see full alliance boards, or do we need an officer-rank session?  
6. How often do client versions break request signing?  
7. Should harness sessions be **per alliance** or a single lab alliance until M5?

## Appendix C — Repo touchpoints (when implementation starts)

- Ingest reuse: `src/lib/video/submit-dispatch.ts`, `src/lib/data-management/batch-ledger.server.ts`  
- Score target ids: `src/lib/video/score-targets.ts`  
- Existing Last War client: `src/lib/lastwar/`  
- Ashed catalog precedent: `scripts/har/extract-catalog.mjs`, `docs/ashed-api-catalog.json`  
- Server time / VS week: `.cursor/rules/alliance-affairs.mdc`, `.cursor/rules/trains.mdc`  
- Credential UX precedent: Discord authorize nonces (never put secrets in slash options)
