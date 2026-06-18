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
| `auth:read` | User/me, UserProfile, Referral |
| `alliance:admin` | Connect/disconnect Ashed token, manage HQ roles |

## Role templates

| Role | Description | Excludes |
|------|-------------|----------|
| **owner** | Full HQ access including token and RBAC admin | — |
| **officer** | All data operations | `data:bulk_delete`, `data:bulk_move`, `alliance:admin` |
| **data_entry** | Member updates, score upload, events | Destructive ops, admin |
| **viewer** | Read-only across alliance data | All writes |

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
| Video upload (HQ) | `upload:write` |
