# Multi-tenant routing

Alliance HQ is a multi-alliance application. Routes fall into three scopes; alliance context is stored on the session (`currentAllianceId`) and selected via the sidebar alliance picker.

## Scope contract

| Scope | URL prefix | Who | Alliance binding |
|-------|------------|-----|------------------|
| **Platform** | `/admin/*` | Platform maintainers only | Cross-tenant (intentional) |
| **Account** | `/account/*` | Signed-in HQ user | None — user prefs and credentials |
| **Alliance** | All other `(app)` routes | Active `alliance_memberships` row | `session.currentAllianceId` |

Resolution pattern for native features: `session.currentAllianceId ?? session.allianceId`.

Ashed iframe pages embed `https://ashed.online/...`; in-iframe alliance context uses the Ashed JWT.

## Platform routes (`/admin/*`)

Maintainer gate: `src/app/[locale]/(app)/admin/layout.tsx`.

| Path | Purpose |
|------|---------|
| `/admin` | Overview hub |
| `/admin/system` | System config |
| `/admin/alliances` | Native alliance console |
| `/admin/users` | All HQ users and memberships (cross-tenant) |
| `/admin/audit` | Audit log |
| `/admin/video-jobs`, `/analytics`, `/[jobId]` | Video pipeline |
| `/admin/parse-configs` | OCR parse configs |
| `/admin/experiments`, `/[campaignId]` | A/B campaigns |
| `/admin/hq-events` | HQ event occurrences |
| `/admin/commendations` | Commendations |
| `/admin/bug-reports`, `/experience-feedback`, `/translation-reports` | Feedback ops |

## Account routes

| Path | Purpose |
|------|---------|
| `/account` | Timezone, Ashed token, device linking, disconnect |
| `/connect` | Ashed onboarding (connect-flow) |
| `/pair` | Device pairing entry (connect-flow) |
| `/releases` | Platform release notes |

## Alliance settings

| Path | Purpose |
|------|---------|
| `/settings` | Alliance hub: game season |
| `/settings/team` | HQ team roster for **current alliance** (emails visible to all active members) |

Team Access is **not** `/admin/users`. Admin users is platform-scoped; Team Access lists only `alliance_memberships` for `currentAllianceId`.

Refresh from Ashed on Team Access requires `alliance:admin`.

## Native alliance pages

| Path | Binding |
|------|---------|
| `/members` | `currentAllianceId ?? allianceId` |
| `/trains` | Same |
| `/viral-resistance` | Same |
| `/tools/video-upload`, `/[jobId]/review`, `/[jobId]/event` | Session / job scope |

## Ashed iframe pages (`/[page]`)

Dynamic route: `src/app/[locale]/(app)/[page]/page.tsx`.

`/dashboard`, `/alliances`, `/waiting-list`, `/alliance-tasks`, `/merge-manager`, `/vs-performance`, `/donations`, `/alliance-exercise`, `/reports`, `/data-management`, `/unmatched-names`, `/desert-storm`, `/canyon-storm`, `/seasonal-events`, `/zombie-siege`

## Connect-flow (one-time)

| Path | Notes |
|------|-------|
| `/invite/[token]` | Sets `currentAllianceId` on accept |
| `/discord/authorize` | Bot credential setup |

## Public

`/privacy`, `/terms`

## Sidebar alliance picker

Lists active HQ memberships for the signed-in user. Switching calls `PATCH /api/session/current-alliance` with server-side membership verification.

API: `GET /api/session/alliances` — list memberships with tag, name, role.

## Security notes

- Team Access exposes email addresses to any active alliance member.
- Sidebar alliance switch must verify membership server-side.
- Platform maintainers use the picker for alliance context; cross-tenant ops stay on `/admin/*`.
