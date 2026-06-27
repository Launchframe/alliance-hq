# RBAC permission matrix

Human-readable summary. Machine-readable source of truth: [`ashed-api-catalog.json`](./ashed-api-catalog.json) → `rbac` section (regenerate with `npm run har:catalog`).

## Design intent

Ashed limits shared seats to three; Alliance HQ adds **many HQ users per alliance** with finer-grained permissions. Destructive operations (`bulkDeleteByDate`, `bulkMoveByDate`) require explicit high-privilege roles — the main RBAC win over raw seat access.

**Deny by default:** the BFF only forwards operations listed in the catalog's `rbac.operationMap`.

## Permissions

| Permission | Allows |
|------------|--------|
| `members:read` | GET Member, WaitingListMember, ExcusedRecord |
| `members:write` | PUT Member, POST commendations/violations, setJoinedDate |
| `tasks:read` | GET AllianceTask |
| `tasks:write` | POST/PUT AllianceTask |
| `merge:read` | GET MergeSession |
| `merge:write` | POST/PUT MergeSession |
| `alliance:read` | GET Alliance, Partner, EntitlementSnapshot |
| `alliance:write` | recordPartnerEngagement |
| `scores:read` | GET VSScore, Donation, exercise/score/kill entities |
| `scores:write` | POST/PUT score entities, manageSquadPowerData |
| **`trains:write`** | **Train conductor schedule, rolls, lock-in (owner/maintainer/officer only)** |
| `reports:read` | GET WeeklyVSReport, WeeklyAllianceReport |
| `reports:generate` | generateWeeklyAllianceReport |
| `events:read` | GET event/roster/score entities |
| `events:write` | POST/PUT event data, extractZombieSiegeData |
| `data:read` | GET UnmatchedName |
| `data:write` | PUT UnmatchedName |
| `data:bulk_delete` | bulkDeleteByDate (**destructive**) |
| `data:bulk_move` | bulkMoveByDate (**destructive**) |
| `upload:write` | Core/UploadFile, ExtractDataFromUploadedFile, InvokeLLM |
| **`hq:video:read`** | **List alliance video jobs / processor queue** |
| **`hq:video:enqueue`** | **Upload and queue video jobs (no Ashed credential required)** |
| **`hq:video:process`** | **Approve and run OCR on queued jobs (runtime: owner/maintainer bypass or explicit processor slot; Ashed credential required at approve time when `VIDEO_OCR_PROVIDER=ashed`, the default)** |
| `auth:read` | User/me, UserProfile, Referral |
| `alliance:admin` | Connect/disconnect Ashed token, manage HQ roles |

## Role templates

| Role | Description | Excludes |
|------|-------------|----------|
| **owner** | Full HQ access including token and RBAC admin | — |
| **maintainer** | Same as owner for HQ-native permissions | — |
| **officer** | All data operations + video enqueue | `data:bulk_delete`, `data:bulk_move`, `alliance:admin`, `hq:video:read` (unless granted a processor slot) |
| **data_entry** | Member updates, score upload, events | Destructive ops, admin |
| **viewer** | Read-only across alliance data | All writes |

### Video processor slots (Ashed ToS)

Officers may **enqueue** uploads (`hq:video:enqueue`) without an Ashed connection. **Processing** (OCR via Ashed) is limited:

| Who can process | Slot required? | Ashed required at approve? |
|-----------------|----------------|----------------------------|
| Platform maintainer | No | When `VIDEO_OCR_PROVIDER=ashed` (default) |
| Owner / maintainer | No (bypass) | When `VIDEO_OCR_PROVIDER=ashed` (default) |
| Officer with processor slot | Yes (max **2** per alliance) | When `VIDEO_OCR_PROVIDER=ashed` (default) |
| Officer without slot | — | — |

**Nonprod OCR (`VIDEO_OCR_PROVIDER=local|mock`, dev/e2e only unless `VIDEO_OCR_ALLOW_NONPROD=true`):** approve does **not** require Ashed. `mock` uses fixtures for score targets (and roster in mock mode); `local` runs native Tesseract on roster video targets.

Owners assign processor slots under **Settings → Team access** or **Video → Video processors** (`/tools/video-processors`). All alliance members can view the roster; only owners/maintainers manage slots. Jobs stay `pending_approval` until a processor approves them; with default Ashed OCR, approving without Ashed returns **409** `ashed_not_connected` (recoverable — job remains pending).

**Candidate pool (settings selector):**

| Operating mode | Eligible for designation |
| --- | --- |
| **Ashed** | Active **officers** whose HQ account has linked Ashed before (`hq_users.ashed_user_id`) |
| **Native** | HQ users linked to in-game **R4 or R5** roster members (`hq_member_links` + `alliance_members`) |

Full permission lists per role are in `rbac.roleTemplates` in the catalog JSON.

## Entity → permission map

| Entity | Read | Write |
|--------|------|-------|
| Member | `members:read` | `members:write` |
| Commendation, Violation | `members:read` | `members:write` |
| WaitingListMember, ExcusedRecord | `members:read` | — |
| AllianceTask | `tasks:read` | `tasks:write` |
| MergeSession | `merge:read` | `merge:write` |
| Alliance, Partner | `alliance:read` | — |
| VSScore, VSCompetitionMeta, Donation | `scores:read` | `scores:write` |
| AllianceExercise, AllianceExerciseScore | `scores:read` | `scores:write` |
| KillScore, SeasonReward, TrainRoster | `scores:read` | `scores:write` |
| WeeklyVSReport, WeeklyAllianceReport | `reports:read` | — |
| DesertStorm*, CanyonStorm*, Seasonal*, ZombieSiege* | `events:read` | `events:write` |
| UnmatchedName | `data:read` | `data:write` |
| User, UserProfile, Referral | `auth:read` | — |

## Function → permission map

| Function | Permission | Destructive |
|----------|------------|-------------|
| bulkDeleteByDate | `data:bulk_delete` | Yes |
| bulkMoveByDate | `data:bulk_move` | Yes |
| manageSquadPowerData | `scores:write` | No |
| generateWeeklyAllianceReport | `reports:generate` | No |
| getAvailableVSWeeks | `scores:read` | No |
| setJoinedDate | `members:write` | No |
| recordPartnerEngagement | `alliance:write` | No |
| getSeasonalEvents | `events:read` | No |
| extractZombieSiegeData | `events:write` | No |

## Integration → permission map

| Integration | Permission |
|-------------|------------|
| Core/UploadFile | `upload:write` |
| Core/ExtractDataFromUploadedFile | `upload:write` |
| Core/InvokeLLM | `upload:write` |

## Nav page → primary permissions

Quick reference for UI gating (full mapping in catalog `navGroups`):

| Nav page | Primary permissions |
|----------|---------------------|
| Dashboard | `members:read`, `alliance:read` |
| Members | `members:read`, `members:write` |
| VS Performance | `scores:read` |
| Reports | `reports:read`, `reports:generate` |
| Data Management | `data:bulk_delete`, `data:bulk_move`, `upload:write` |
| Settings (HQ) | `alliance:admin` |
| Video upload (HQ) | `hq:video:enqueue` |
| Video queue (HQ) | `hq:video:read` or explicit processor slot; approve/reject requires process capability |
