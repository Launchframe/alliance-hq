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
| `R2_BUCKET` | e.g. `alliance-hq-video-queue` (must match the bucket you configure below) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Cloudflare R2 API token with read/write on that bucket |

- [ ] Set all of the above on **Production** (and **Build** scope for vars used at build time).
- [ ] Redeploy production after env changes so `metadataBase`, magic-link URLs, and invite links use the new origin.

**Do not** set `LOCAL_DATABASE_URL` on Vercel.

### 2b. R2 — bucket CORS for browser uploads

Direct video upload sends a **cross-origin `PUT`** from the browser to `*.r2.cloudflarestorage.com`. Without bucket CORS, the **OPTIONS preflight returns 403** and the console shows `No 'Access-Control-Allow-Origin' header`.

1. Cloudflare dashboard → **R2** → open the bucket named in `R2_BUCKET` (production uses **`alliance-hq-video-queue`**).
2. **Settings** → **CORS policy** → paste (adjust origins if you add preview hosts):

```json
[
  {
    "AllowedOrigins": [
      "https://frontline.gay",
      "https://www.frontline.gay",
      "http://localhost:5175"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

3. Save, wait a minute, retry upload from **Tools → Upload from video**.

The app presigns `PutObject` with a **`Content-Type`** header (see `client-upload.ts`), so `AllowedHeaders` must include `Content-Type`. Multipart part uploads need **`ExposeHeaders: ["ETag"]`** so the client can complete the multipart upload.

For Vercel preview deploys, add each preview origin (or a documented preview URL pattern if your team uses one) to `AllowedOrigins` — R2 does not read CORS from application env vars.

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

### 6. Google OAuth + Search Console

Google OAuth app verification requires a **public homepage** at `https://frontline.gay` (no login wall), plus **domain ownership** proof.

#### A. Verify domain ownership

1. [Google Search Console](https://search.google.com/search-console) → Add property **`https://frontline.gay`** (URL-prefix or Domain property).
2. **DNS (recommended):** Add the TXT record Google provides at your `frontline.gay` DNS host (same registrar panel as Vercel apex records). Wait until Search Console shows **Verified**.
3. **HTML meta (fallback):** In Search Console, choose the HTML tag method → copy the `content` value only → set `GOOGLE_SITE_VERIFICATION` on Vercel Production → redeploy → View Page Source on `/` and confirm `<meta name="google-site-verification" content="…" />` is present.

#### B. OAuth consent screen URLs

After deploy, confirm these load **without signing in**:

| Field | URL |
| ----- | --- |
| Application home page | `https://frontline.gay` |
| Privacy policy | `https://frontline.gay/privacy` |
| Terms of service | `https://frontline.gay/terms` |

- [ ] **Authorized domains:** `frontline.gay`
- [ ] **Redirect URI:** `https://frontline.gay/api/auth/callback/google`
- [ ] Re-submit OAuth verification after Search Console is green and the public homepage is live.

### 7. Repo gates (before merge)

- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run i18n:validate`

---

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------- |
| Magic link points at `*.vercel.app` | `NEXT_PUBLIC_APP_URL` not set or deploy stale |
| Video upload CORS / OPTIONS 403 on `r2.cloudflarestorage.com` | R2 bucket CORS missing `https://frontline.gay` (see **§2b**) |
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
