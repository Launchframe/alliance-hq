# Video OCR DRY follow-up — deposit-slip vs roster

**Status:** Planning doc (2026-07-31).  
**Scope:** Overlap between `src/lib/banks/deposit-slip-ocr/` and `src/lib/banks/roster-ocr/`.  
**Policy:** Do **not** extract shared modules until **two** call sites need the same rule and tests are green on both pipelines.

## Shared concerns (extract when touching both)

| Concern | Deposit-slip | Roster | Proposed shared module |
|---------|--------------|--------|------------------------|
| OCR line normalization | `normalize-deposit-slip-ocr-lines` | roster line normalizers | `ocr-line-normalize.shared.ts` |
| Vertical proximity / y-band | `assignFieldsByVerticalProximity` | roster column assignment | `ocr-vertical-association.shared.ts` |
| Row-content boundary probe | `isDepositSlipRowContentProbe` | roster row guards | `ocr-row-content-boundary.shared.ts` |
| Commander/name normalize | `deposit-slip-commander-normalize` | roster name fold | `ocr-commander-name.shared.ts` |
| Tolerant keyword regex | deposit keyword classes | rank/header keywords | `ocr-tolerant-keyword.shared.ts` |
| Member match fuzzy | `resolve-deposit-slip-member` | roster member resolve | Keep server-specific; share **scores** only |
| Timestamp parse/repair | deposit timestamp + infer | roster date columns | **Do not merge** — different semantics |
| Dedupe / cluster UI | `deposit-slip-dedupe`, flagged-clusters | N/A | Deposit-slip only |

## Deposit-slip–specific (keep local)

- `mergeDepositSlipHistoryParses`, funding batch linkage, Savings/deposit ledger (N/A for roster).
- `DepositSlipVideoReviewTable`, dedupe cluster reasons, alliance tag optional policy.
- Outcome lines (Total return, Early termination refund).

## Roster-specific (keep local)

- Alliance rank columns, VS week headers, immutable rank events.
- City List / bank stronghold OCR (season 5) — separate from deposit-slip history.

## Extraction order (recommended)

1. **`ocr-row-content-boundary.shared.ts`** — when geometry fix lands for deposit-slip; roster can adopt same “stop search at content line” helper.
2. **`ocr-tolerant-keyword.shared.ts`** — char-class builders for Tesseract confusions (D/O, e/a, l/1).
3. **`ocr-commander-name.shared.ts`** — after borderline-merge thresholds stabilize on deposit-slip.

## Test strategy for extractions

- Move existing `*.shared.test.ts` cases with the helper; leave pipeline integration tests in place.
- Run deposit-slip worker tests + roster OCR tests on every extraction PR.
- No new e2e required for pure lib moves; update unit tests only.

## Anti-patterns

- **Mega `ocr-utils.ts`** — grows unreviewable; keep one concern per file.
- **Premature merge of timestamp logic** — deposit video frames ≠ roster static screenshots.
- **Sharing React review components** — deposit-slip review is unique; share types only (`FlagReason`, cluster shapes).

## Related

- [deposit-slip-ocr-hardening-audit.md](./deposit-slip-ocr-hardening-audit.md) — full rule catalog and remediation stack.
- PR #464 — video downscaling (not a substitute for parser hardening).
- PR #490 — timestamp `invalid_date` repair.
