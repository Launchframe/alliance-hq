# Fresh native alliance — onboarding from leadership cold start

> **TODO:** Translate to Portuguese (`pt-BR`) when operator docs are localized.  
> **Audience:** **owners and first officers** of **native** alliances (`operatingMode: native`) with **no Ashed roster** yet — e.g. a new HQ tenant or owner-less shell where only one leadership invite has been accepted.  
> **Goal:** grow from one linked leadership user to a linked officer team and a roster where every member can claim their commander.

---

## What is different here

| Ashed-sync alliance | Fresh native (this guide) |
| --- | --- |
| Roster often imported on day one | Roster starts **empty** |
| Officers focus on **linking** existing rows | First **owner or officer** invitee cold-starts roster + game server |
| Ashed optional for native RBAC | **No Ashed required** — iframe/sync tools optional later |

You do **not** need Ashed to run a native alliance on HQ. RBAC comes from **invites**; roster rows appear as people link, get approved, or you import from video OCR.

---

## Phase 1 — First leadership link (day zero)

```mermaid
flowchart TD
  A[PA provisions native alliance] --> B[Leadership invite: owner or officer]
  B --> C[Invitee signs in and accepts invite]
  C --> D[/onboard — UID confirm]
  D --> E[Leadership cold-start: first roster row + game server]
  E --> F[Leadership can open Team access]
```

### First invitee checklist (owner or officer)

1. **Accept** the leadership invite (owner from PA, or officer for owner-less shells).
2. Complete **`/onboard`**: enter **player UID only**, confirm the resolved commander name, submit.
3. On first link with an empty native roster, HQ can **adopt your game server** and create your commander row automatically (leadership cold-start).
4. Confirm **Settings → Alliance** shows the correct game server.

**Owner-less shells:** issue an **officer** invite first — that officer cold-starts without waiting for an owner email or roster-link approval.

Until someone leadership-linked has adopted the game server, downstream invites may be blocked by the **game server required** gate.

---

## Phase 2 — Bring officers onto HQ

1. **Settings → Team access** → invite each R4/R5 with role **Officer** (protected link + passphrase is common for bulk handoff in chat).
2. Each officer: accept invite → sign in → **`/onboard`** → UID confirm.

### If a later officer is not on the roster yet

After the first roster row exists, additional officers may still hit **roster miss** or **awaiting owner approval** (invite-gated email/protected-link paths):

- Owner receives email with **approve / reject** links.
- On approve, HQ can create the roster row and link the officer.

The **first** officer on an empty roster cold-starts directly (same gate as owner).

Discord `/link-commander` is a separate path; this guide covers **web HQ** onboarding.

---

## Phase 3 — Grow the roster snapshot

Native alliances add `alliance_members` rows through:

| Method | Who | When |
| --- | --- | --- |
| **Member link / owner approval** | Each player + owner | Invited members prove UID |
| **Video roster OCR** | Officers with video tools | Bulk import from leaderboard recording |
| **Ashed connect** (optional later) | Owner | Switch to sync model if you adopt Ashed |

You do not need a full roster before inviting members — but **commander claim** pickers work best once names exist in HQ.

---

## Phase 4 — Onboard the rest of the alliance

When roster names are present (from OCR, approvals, or sync):

### Preferred: commander claim invites

**Settings → Team access → Commander claim**

- **One commander** — single link + passphrase for one unlinked roster member.
- **Multiple** — checkbox list, bulk generate (up to 100 per batch).

Send each player their **own** link and passphrase. They accept → `/onboard` → UID confirm → linked to the commander you selected.

### Alternative: join codes or generic member invites

**Join codes** — one code, many redemptions, all get **member** RBAC; everyone still completes `/onboard`.

**Generic member invite** — same as join code for one person; use when you have not picked their roster row yet.

As the roster fills toward **100 in-game members**, shift emphasis to **claim invites** so each HQ account binds to the right commander.

---

## Suggested order (e.g. BigD rollout)

1. Owner links self and verifies game server.
2. Owner invites **co-leads / R4** as **Officer**.
3. Officers link; owner approves any roster misses.
4. Optional: one **video OCR** pass to seed the member list if you have a recent recording.
5. Bulk **commander claim** invites for all unlinked roster members (Discord, LINE, in-game mail — however you distribute secrets).
6. Stragglers: generic member invite or join code + owner approval for roster miss.

---

## Permissions cheat sheet

| Role invite | HQ permissions | Still needs member link? |
| --- | --- | --- |
| **Owner** | Full (PA-provisioned only) | Yes |
| **Officer** | Trains, invites, member tools per RBAC | Yes |
| **Member** (generic or claim) | Standard member access | Yes — claim pre-selects commander |
| **Viewer / data_entry** | Limited write/read | Yes |

Commander **claim** invites always create **member** RBAC. Use a separate **officer** invite when someone needs officer tools.

---

## Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| “Game server required” on invite | Server not linked | Owner completes member link / PA sets server |
| Officer stuck on roster miss | Name not in HQ roster yet | Owner approves roster link request or refresh/import roster |
| Claim invite says already claimed | Commander already linked | Pick another member or break-glass unlink (owner/maintainer) |
| Player linked wrong character | Generic invite + similar names | Use claim invites; owner unlink + re-issue |

---

## See also

- [Ashed-sync alliance onboarding](./ashed-alliance-member-onboarding.md) — full roster from day one
- [Alliance onboarding hub](/guides/alliance-onboarding) — pick your path
- Engineering flow (APIs): [native-alliance-onboarding.md](./native-alliance-onboarding.md)
