# Pre-commit gates

Run these checks **in order** before every commit. All must pass.

```bash
npx tsc --noEmit
npm run lint
npm run test
npm run db:validate-journal
```

| Step | Command | Purpose |
|------|---------|---------|
| 1 | `npx tsc --noEmit` | TypeScript type-check (no emit) |
| 2 | `npm run lint` | ESLint |
| 3 | `npm run test` | Vitest unit tests |
| 4 | `npm run db:validate-journal` | Drizzle SQL files ↔ `_journal.json` |

If any step fails, fix the issue and re-run from the top.
