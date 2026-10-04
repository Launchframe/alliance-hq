# Pre-commit vs Pre-PR gates

Husky **pre-commit** runs the cheap-enough suite: typecheck, lint, Vitest, i18n, Drizzle journal (see **Gates** below). It does **not** run `npm run build` or Playwright.

**Through 1 Sep 2026:** GitHub **CI is disabled**. Local typecheck / lint / unit / i18n / journal / build / Playwright is the only gate — **`.cursor/rules/gha-credit-freeze.mdc`**.

Qualitative rules before every commit or push:

- No secrets, credentials, or `.env.local` in commits
- New user-facing strings require keys in `messages/en-US.json` and `messages/pt-BR.json`
- Non-trivial logic changes need tests (see `vitest` layout under `src/**/*.test.ts`)
- RBAC: new BFF routes must enforce permissions; admin routes require platform maintainer
- Migrations and seeds must be idempotent for redeploy
- Every `drizzle/NNNN_*.sql` must have a matching entry in `drizzle/meta/_journal.json` (see **Drizzle migrations** in `AGENTS.md`)

## Commit (husky)

Run from repository root, in order. All must pass. (Matches `.husky/pre-commit`.)

### 1. Typecheck

```bash
npx tsc --noEmit
```

### 2. Lint

```bash
npm run lint
```

### 3. Test

```bash
npm test
```

### 4. i18n

```bash
npm run i18n:validate
```

### 5. Drizzle migration journal

```bash
npm run db:validate-journal
```

## Pre-PR / Real Steel push

Before **`gh pr create`** (including drafts): **`npm test`** must have passed on current `HEAD` in this session.

Run the **full** sequence below from the repository root **in order** before marking a PR ready, merging to **`main`**, pushing to an **open non-draft** PR, or Real Steel **push** after a pass. All must pass. Draft WIP pushes may skip the full gate until the PR is marked ready or becomes non-draft — still do not skip Husky on commit.

### 6. Production build (typecheck of the Next compile)

```bash
npm run build
```

### 7. Playwright (product PRs; skip docs-only)

GitHub **CI is disabled** through **1 Sep 2026** (Actions credit freeze). Do not wait for CI or a Vercel preview. See **`.cursor/rules/gha-credit-freeze.mdc`**.

```bash
npm run test:e2e
```

Auth / invite / connect / session / admin RBAC / `e2e/**`: update specs first (`.cursor/rules/e2e-plan-completion.mdc`).
