# Deploy: frontline.gay + Resend magic links

Production hosted Alliance HQ uses **`https://frontline.gay`**. The app can stay on Vercel; magic-link email requires a **verified sending domain** in Resend (you cannot use `*.vercel.app`).

Code fallbacks and copy reference `frontline.gay` via `src/lib/public-site.ts`.

---

## Pre-ship checklist (PR #42)

Complete these **in order** before marking the auth + email release done.

### 1. DNS — point domain at Vercel

- [ ] In **Vercel** → Project → **Settings → Domains**, add `frontline.gay` (and optionally `www.frontline.gay`).
- [ ] At your registrar/DNS host, add the records Vercel shows (apex `A`/`ALIAS` and/or `CNAME` for `www`).
- [ ] Wait until Vercel shows the domain as **Valid** (SSL issued).
- [ ] Confirm `https://frontline.gay/api/health/db` returns OK.

### 2. Vercel environment (Production + Preview if needed)

| Variable | Production value |
| -------- | ---------------- |
| `NEXT_PUBLIC_APP_URL` | `https://frontline.gay` |
| `AUTH_SECRET` | `openssl rand -base64 32` (store once; do not rotate casually) |
| `RESEND_API_KEY` | From [Resend](https://resend.com) → API Keys |
| `EMAIL_FROM` | `Alliance HQ <auth@frontline.gay>` |
| `DATABASE_URL` | Neon Postgres (unchanged) |
| `TOKEN_ENCRYPTION_KEY` | Unchanged |

- [ ] Set all of the above on **Production** (and **Build** scope for vars used at build time).
- [ ] Redeploy production after env changes so `metadataBase`, magic-link URLs, and invite links use the new origin.

**Do not** set `LOCAL_DATABASE_URL` on Vercel.

Local dev without verified Resend domain:

```bash
EMAIL_FROM="Alliance HQ <onboarding@resend.dev>"
NEXT_PUBLIC_APP_URL=http://localhost:5175
```

### 3. Resend — verify frontline.gay

- [ ] Resend dashboard → **Domains** → Add **`frontline.gay`**.
- [ ] Add DNS records Resend provides (SPF, DKIM; follow their UI for `.gay` TLD).
- [ ] Wait until domain status is **Verified**.
- [ ] Create/use API key with send permission → set `RESEND_API_KEY` on Vercel.
- [ ] Set `EMAIL_FROM` to an address on that domain (e.g. `auth@frontline.gay`).
- [ ] Send a test magic link from `/auth` on production; confirm link host is `frontline.gay` and mail is not spam-foldered.

### 4. Auth smoke test (production)

- [ ] Open `https://frontline.gay/auth` → request magic link.
- [ ] Click link → lands on `/get-started` or app shell when access exists.
- [ ] **Wrong account?** on `/get-started` → sign out → `/auth`.
- [ ] Protected invite + join code flows still work with new origin in redirect URLs.

### 5. Optional — retire vercel.app as primary URL

- [ ] In Vercel Domains, set `frontline.gay` as **primary** (redirect `alliance-hq.vercel.app` → `frontline.gay` if desired).
- [ ] Update Discord bot / bookmarks / release notes links to `https://frontline.gay`.

### 6. Repo gates (before merge)

- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run i18n:validate`

---

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------- |
| Magic link points at `*.vercel.app` | `NEXT_PUBLIC_APP_URL` not set or deploy stale |
| Resend 403 / domain error | `EMAIL_FROM` domain not verified in Resend |
| Mail in spam | Use verified domain + complete SPF/DKIM; avoid `@resend.dev` in prod |
| Auth callback error | `AUTH_SECRET` missing or changed mid-session |

---

## Related files

| Area | Location |
| ---- | -------- |
| Production host constant | `src/lib/public-site.ts` |
| App origin helper | `src/lib/app-origin.ts` |
| Magic link provider | `src/lib/auth/index.ts` |
| Env template | `.env.example` |
