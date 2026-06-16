<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Pre-commit gates

Before creating a commit, all checks in [`PRE-COMMIT.md`](./PRE-COMMIT.md) must pass, in order:

1. `npx tsc --noEmit`
2. `npm run lint`
3. `npm run test`

Do not commit while any gate is failing.

## Client vs server imports (Next.js bundles)

**`"use client"` components and hooks must not import modules that pull in Node or Postgres.** Next will try to bundle those for the browser and fail (`Can't resolve 'fs'`, `postgres`, etc.).

Before wiring a client component to shared logic, trace the import chain:

| Safe in client | Server-only — never import from `"use client"` |
| --- | --- |
| Pure helpers, types, formatters under `lib/` with no DB/session | `@/lib/db`, `@/lib/session`, `@/lib/trains/rank-sync`, Prisma/postgres, `fs`/`path`/`crypto` server helpers |
| `*.shared.ts` modules (explicit client-safe surface) | API route handlers, `*.server.ts` modules marked `import "server-only"` |

**Pattern:** put optimistic UI / validation in `feature.shared.ts`; keep mutations in `feature.server.ts` (top line: `import "server-only"`) or route handlers. Client code calls `fetch('/api/…')` instead of importing server libs.

**Smell:** a new `lib/` helper imported by both a page client component and an API route — split it immediately; do not re-export server code from the same barrel the client uses.

## Real Steel review focus

Apply on every Real Steel pass for this repo:

- **Client bundle hygiene** — `"use client"` files must not transitively import `@/lib/db`, `@/lib/session`, rank-sync, or other server-only modules; use `*.shared.ts` + API routes (see **Client vs server imports** above)
- **RBAC enforcement** — every new/changed BFF route calls `requireSessionPermission` or equivalent; platform maintainer checks on `/admin/*` and `/api/admin/*`
- **Tenant isolation** — alliance-scoped queries filter by session alliance; admin cross-tenant reads are intentional and read-only where documented
- **Ashed sync vs manual roles** — `source: manual` memberships must not be overwritten by connect/settings sync
- **Legacy sessions** — behavior when `hq_user_id` is null (allow-all until reconnect) must remain consistent
- **Bootstrap safety** — `PLATFORM_BOOTSTRAP_EMAIL` only promotes when zero platform maintainers exist; no privilege escalation on reconnect
- **Deploy seeds** — `db:prepare` migrations/seeds idempotent; safe to run on every Vercel build
- **i18n** — new UI strings in en-US and pt-BR; run `npm run i18n:validate`
- **Video pipeline** — admin requeue/reprocess must not double-process or lose job state
- **No prod SQL for ops** — admin UI should cover role assignment, commendations, and job recovery without ad-hoc queries
- **Trains** — GET routes use `scores:read`; mutations use `trains:write` via `requireTrainOfficer`; tenant-scoped by session alliance; conductor lock is immutable without audited override; season + ritual detail in [`.cursor/rules/trains.mdc`](.cursor/rules/trains.mdc)

## Last War domain (game mechanics)

Alliance HQ models **in-game** alliance mechanics (trains, VS weeks, R1–R5 ranks) separately from **HQ RBAC** and Ashed iframe pages. Game server time is **UTC−2**; VS match weeks run Mon–Sat with Sunday off; calendar weeks start Monday 00:00 server time.

- Alliance ranks **R1–R5** are stored in immutable **`member_alliance_rank_events`**; confirmed changes dual-write to Ashed `Member` and update **`alliance_members`** (locally synced roster with normalized rank/title). Members page refresh syncs from Ashed; train pools read local roster, not live Ashed queries.
- Train conductor mutations require **`trains:write`** (owner/maintainer/officer — not `data_entry`).
- **Game season** — owner override → Monday cpt-hedge cron → age fallback (caps S4) → default `"1"`; see [`.cursor/rules/trains.mdc`](.cursor/rules/trains.mdc).
- Full terminology and train rules: [`.cursor/rules/trains.mdc`](.cursor/rules/trains.mdc) (ranks + server time: [`.cursor/rules/alliance-affairs.mdc`](.cursor/rules/alliance-affairs.mdc)).

