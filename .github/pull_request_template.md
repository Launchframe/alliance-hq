## What does this change

## Why are you changing it

## How did you accomplish this

## Local validation

Follow `PRE_COMMIT_GATE.md` (shared by Devin and Cursor). Do not wait for disabled GitHub Actions or count a Vercel preview as local validation.

- Validation scope: standalone PR / final stack tip / intermediate WIP
- Tested tip SHA and covered parent SHAs:
- Normal commit hooks: typecheck, lint, unit tests, i18n, journal — results:
- Guarded production build: included in `npm run test:e2e` / separate guarded build / N/A docs-only
- Full unfiltered Playwright run: passed / failed / pending / N/A docs-only
- Browser workers and passed / failed / skipped counts:
- Focused checks, retries, interruptions, and remaining blockers:
- Exact commands, elapsed times, and log locations:

One full gate at the final stack tip covers the recorded parent SHAs; do not claim each parent ran that suite independently. Keep normal hooks on every commit. Docs/rules-only changes need hooks and documentation checks, not build/Playwright; runtime harness/config changes still need the full gate.
