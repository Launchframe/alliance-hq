# Pre-commit gate

Qualitative rules before every commit or push:

- No secrets, credentials, or `.env.local` in commits
- New user-facing strings require keys in `messages/en-US.json` and `messages/pt-BR.json`
- Non-trivial logic changes need tests (see `vitest` layout under `src/**/*.test.ts`)
- RBAC: new BFF routes must enforce permissions; admin routes require platform maintainer
- Migrations and seeds must be idempotent for redeploy
- Every `drizzle/NNNN_*.sql` must have a matching entry in `drizzle/meta/_journal.json` (see **Drizzle migrations** in `AGENTS.md`)

## Gates

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
