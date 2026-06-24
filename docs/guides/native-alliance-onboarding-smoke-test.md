# Native alliance onboarding — smoke test

Manual verification for owner onboarding unblockers (PR #70+). Run against a **staging** or **preview** deploy with platform maintainer access.

## Prerequisites

- Platform maintainer session
- A fresh native alliance (or one with empty roster and no `game_server_id`)
- Owner invite accepted, landed on `/onboard`

---

## 1. Happy path (baseline)

| Step | Action | Expected |
|------|--------|----------|
| 1 | PA creates native alliance | No server on alliance |
| 2 | PA sends **owner** invite | 200, invite URL returned |
| 3 | Owner accepts → `/onboard` | Wizard loads |
| 4 | Submit exact Last War name + UID | `linked` → redirect `/members` |
| 5 | Check alliance | `game_server_id` set, owner on roster |

---

## 2. Name mismatch → retry loop

| Step | Action | Expected |
|------|--------|----------|
| 1 | On `/onboard`, enter a **deliberately wrong** name but valid UID | `name_mismatch` — form stays open with error |
| 2 | UI shows Last War name + **Use suggested name** | Tapping fills the correct name |
| 3 | Submit again with matching name | `linked` |

**Not feasible in prod:** N/A — uses real Last War lookup with intentional typo.

---

## 3. Missing server from lookup → owner prompt

Simulate when Last War returns a player **without** `server` and UID suffix is not parseable (use a test UID ending in `0000` if API omits server, or mock in dev).

| Step | Action | Expected |
|------|--------|----------|
| 1 | Submit name + UID where lookup succeeds but no server field | `confirm_server` screen |
| 2 | Enter state server number (e.g. `1203`) | `linked`, alliance server adopted |

**Dev shortcut:** Unit test `returns confirm_server when lookup has no game server number` in `roster-link-request.server.test.ts`.

---

## 4. Pre-set wrong server → owner confirms / overrides

| Step | Action | Expected |
|------|--------|----------|
| 1 | PA sets wrong server in **Admin → Alliances** inline edit (e.g. `9999`) | Alliance has mismatched server |
| 2 | Owner submits valid name + UID (lookup server `1203`) | `confirm_server` with Last War vs alliance numbers |
| 3 | Enter correct server `1203` and continue | `linked`, server updated to `1203` |

---

## 5. UID already linked → admin alert

| Step | Action | Expected |
|------|--------|----------|
| 1 | Complete owner link on alliance A | `hq_member_links` row exists |
| 2 | Second HQ user accepts another invite to same alliance (or replay same UID) | `member_taken` on form |
| 3 | User sees message that admins were notified | `memberTakenBody` copy |
| 4 | PA with `/api/events/admin-alerts` SSE open (or server logs) | `member_link_uid_taken` event with alliance tag + UID |

**Setup tip:** Use two browsers / accounts; link same UID twice on empty-roster owner cold-start.

---

## 6. Last War API down → owner fallback

| Step | Action | Expected |
|------|--------|----------|
| 1 | **Staging only:** block `lastwar-platform.lastwargame.com` (hosts file / proxy) or set invalid `LASTWAR_PLAYER_LOOKUP_URL` | Lookup returns `request_failed` |
| 2 | Owner on empty native roster submits name + UID | `lookup_fallback` screen (not hard error) |
| 3 | Enter state server number | `linked` using typed name (no Last War verify) |

**Not feasible in production:** Do not take down Last War in prod. Verify via staging env var or unit test `returns lookup_fallback when Last War API is down` in `orchestrator.server.test.ts`.

---

## Automated gates (CI)

```bash
npm test
npm run lint
npm run i18n:validate
npm run db:validate-journal
```

Key test files:

- `src/lib/member-link/roster-link-request.server.test.ts`
- `src/lib/member-link/orchestrator.server.test.ts`
