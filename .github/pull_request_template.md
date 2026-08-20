## What does this change

## Why are you changing it

## How did you accomplish this

## Local gates (GitHub CI is off through 1 Sep 2026)

Do **not** wait for GitHub Actions or a Vercel preview. Empty checks are expected. See `AGENTS.md` → Pre-commit / Pre-PR gate and `.cursor/rules/gha-credit-freeze.mdc`.

- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run i18n:validate`
- [ ] `npm run db:validate-journal`
- [ ] `npm run build`
- [ ] Playwright (`npm run test:e2e`) — or **N/A docs-only**
