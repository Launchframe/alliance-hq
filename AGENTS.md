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

## Real Steel review focus

Apply on every Real Steel pass for this repo:

- **RBAC enforcement** — every new/changed BFF route calls `requireSessionPermission` or equivalent; platform maintainer checks on `/admin/*` and `/api/admin/*`
- **Tenant isolation** — alliance-scoped queries filter by session alliance; admin cross-tenant reads are intentional and read-only where documented
- **Ashed sync vs manual roles** — `source: manual` memberships must not be overwritten by connect/settings sync
- **Legacy sessions** — behavior when `hq_user_id` is null (allow-all until reconnect) must remain consistent
- **Bootstrap safety** — `PLATFORM_BOOTSTRAP_EMAIL` only promotes when zero platform maintainers exist; no privilege escalation on reconnect
- **Deploy seeds** — `db:prepare` migrations/seeds idempotent; safe to run on every Vercel build
- **i18n** — new UI strings in en-US and pt-BR; run `npm run i18n:validate`
- **Video pipeline** — admin requeue/reprocess must not double-process or lose job state
- **No prod SQL for ops** — admin UI should cover role assignment, commendations, and job recovery without ad-hoc queries

