# Deposit-slip OCR hardening audit

**Status:** Living audit (2026-07-31).  
**Trigger job:** `T3JyG8XmNwn9wiIH` (Roar alliance, `bank-deposit-slip-history`).  
**Timeline:** Job `createdAt` **2026-07-31T03:09:07Z** — **after** PR #464 downscaling fix (2026-07-29). Garbling persisted post-fix; prioritize **usage-frequency** over pre/post-#464 splits.

## Executive summary

| Category | Count (approx.) | Notes |
|----------|-----------------|-------|
| Deposit-slip parser hardening rules | 40+ | `src/lib/banks/deposit-slip-ocr/` |
| Roster-ocr hardening rules | 25+ | `src/lib/banks/roster-ocr/` |
| Shared DRY candidates | 8 | See [video-ocr-dry-followup.md](./video-ocr-dry-followup.md) |
| Remediation PRs (stacked) | 6+ | Docs → term regex → date/geometry → dedupe UX → uploads → readable IDs |

**Top production pain (job T3JyG8XmNwn9wiIH):**

1. **Deposit term null (~25–35%)** — strict `Deposit:` / `CrystalGold` regex; fix: tolerant keyword + term split (`deposit-slip-outcome-parse.shared.ts`).
2. **Invalid timestamp dates** (`2026-77-25`) — PR #490: `invalid_date` + neighbor repair.
3. **Timestamp misassignment (azukaheh)** — `assignFieldsByVerticalProximity` lacks row-content boundary that `findNearbyDepositSlipTimestamp` has.
4. **Misleading identity conflicts** — `gameServerNumber` in conflict fields; server not editable in review UI; alliance tag optional.
5. **Review cluster noise** — one UI panel per `dedupeClusterId`; officers want grouping by **reason**.
6. **Video uploads list** — `unshift` breaks chronological order; session alliance filter may hide jobs.

## Measurement methodology

### Offline fixtures (this repo)

```bash
node scripts/measure-deposit-slip-ocr-hardening.mjs
```

Compares strict vs tolerant deposit-line parsers on strings from production investigations.

### Production sample (recommended)

1. Query recent completed `bank-deposit-slip-history` jobs (`video_jobs` + `ocr_raw_json`).
2. Re-run `parseDepositSlipText` / `mergeDepositSlipHistoryParses` in a shadow script (pattern: `scripts/ocr-eval-shadow-pass.mjs`, table `ocr_eval_snapshots`).
3. Report per-field null rates: `amount`, `termDays`, `depositAt`, `commanderName`, `allianceTag`.
4. Bucket by **rule family** (timestamp repair, deposit tolerant, geometry) not by deploy date alone.

### Hit-rate interpretation

| Signal | Action |
|--------|--------|
| Tolerant-only hits > 5% of deposit lines | Ship tolerant parser; keep strict as fast path |
| `invalid_date` timestamps > 1% | Keep neighbor repair; monitor false merges |
| Identity conflicts with only tag delta | Auto-resolve via batch majority; drop server from conflict key |
| Borderline name clusters > 10 per job | Tune `reconcileMemberMatchedBorderlineClusters` thresholds |

## Deposit-slip rule catalog

### Timestamp (`parse-deposit-slip-text.shared.ts`, `deposit-slip-infer-missing-timestamps.shared.ts`)

| Rule | Mechanism | Risk |
|------|-----------|------|
| `DEPOSIT_SLIP_TIMESTAMP_RE` | `YYYY-MM-DD HH:MM:SS` | Garbled month/day → invalid_date (PR #490) |
| `repairInvalidDepositSlipDates` | Borrow calendar day from nearest valid frame | Wrong neighbor if scroll fast |
| `inferMissingDepositSlipTimestamps` | Interpolate between bracketing frames | Assumes monotonic video |
| `findNearbyDepositSlipTimestamp` | Vertical search; **stops at row content** | Geometry path must mirror |
| `assignFieldsByVerticalProximity` | y-band assignment | **Missing content boundary** → azukaheh bug |
| `isDepositSlipRowContentProbe` | Deposit/outcome/term lines block timestamp steal | Shared with nearby search |
| Round field on timestamp | Optional `round` digit in pattern | Low |

### Identity & commander

| Rule | File | Notes |
|------|------|-------|
| `parseDepositSlipIdentity` | parse-deposit-slip-text | `[tag] name` + server suffix |
| `normalizeDepositSlipCommanderName` | deposit-slip-commander-normalize | OCR variant folding |
| `matchDepositSlipMember` | resolve-deposit-slip-member.server | Roster + fuzzy |
| Borderline name merge | deposit-slip-dedupe.shared | Same minute, high similarity |

### Deposit / outcome lines

| Rule | File | Notes |
|------|------|-------|
| `DEPOSIT_STRICT_RE` | deposit-slip-outcome-parse | **High term-null rate** |
| Tolerant deposit keyword | deposit-slip-outcome-parse | `Oepasit`, `Depasit`, etc. |
| `parseDepositSlipOutcomeLine` | deposit-slip-outcome-parse | Total return / early refund |
| Term-only fallback | deposit-slip-outcome-parse | Term clean when amount garbled |

### Dedupe & review flags

| Rule | File | Notes |
|------|------|-------|
| `buildDepositSlipConflictFields` | deposit-slip-dedupe.shared | **Remove gameServerNumber** |
| `pickConflictFlagReason` | deposit-slip-dedupe.shared | Map field deltas → reason key |
| `groupUnresolvedFlaggedClusters` | flagged-clusters.shared | By clusterId; UI groups by reason |
| OCR-variant tag auto-resolve | deposit-slip-dedupe.shared | `areLikelyAllianceTagOcrVariants` |
| Batch majority tag | deposit-slip-dedupe.shared | Expand beyond OCR variants |

### Merge & persistence

| Rule | File |
|------|------|
| `mergeDepositSlipHistoryParses` | merge-deposit-slip-parses.shared |
| `process-deposit-slip-job.ts` | Worker orchestration |
| `DepositSlipVideoReviewTable.tsx` | Officer review UI |

## Roster-ocr cross-reference (abbreviated)

Roster pipeline (`src/lib/banks/roster-ocr/`) shares patterns: tolerant regex, vertical geometry, name normalization, member matching. Full overlap matrix in [video-ocr-dry-followup.md](./video-ocr-dry-followup.md).

## Remediation stack (implementation order)

1. **This doc + DRY follow-up + measure script** (`docs/deposit-slip-ocr-hardening-audit`)
2. **Tolerant deposit/term parsing** (`fix/deposit-slip-term-amount-regex`)
3. **Timestamp date repair** (PR #490) + **geometry content boundary** (`fix/deposit-slip-timestamp-geometry`)
4. **Dedupe + review UX** — tag policy, cluster-by-reason UI, borderline merge (`fix/deposit-slip-dedupe-review-ux`)
5. **Video uploads** — chronological merge, alliance visibility (`fix/video-uploads-chronological`)
6. **Readable job IDs** (`fix/video-job-readable-ids`)

## Alliance “book” (deferred)

Officer-maintained known-alliance list for OCR tag hints is **not** on main today. Tags resolve via HQ `alliances` at match time (`resolve-deposit-slip-member.server.ts`). A dedicated book feature is out of scope for this stack; document as future work if tag-null rate remains high after dedupe fixes.

## Maintenance

- Re-run `measure-deposit-slip-ocr-hardening.mjs` when adding fixtures from new failure jobs.
- Update this catalog when adding `*.shared.ts` tolerance rules.
- Link new PRs in the remediation stack table above.
