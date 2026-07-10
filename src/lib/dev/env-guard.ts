/**
 * Dev/preview-only feature gate for pre-production tooling (test-matrix,
 * clear week schedule, etc.).
 *
 * Client-safe (no server imports) so the shell can gate the panel and the API
 * route can 404 with the same predicate.
 *
 * - Playwright (`E2E_TEST=true`): enabled so pre-prod tools can be covered.
 * - On Vercel: enabled for every deployment except `production`.
 * - Locally: enabled unless this is a production build (`NODE_ENV=production`).
 */
export function isDevOrPreviewEnvironment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv === "production") {
    return false;
  }
  if (process.env.E2E_TEST === "true") {
    return true;
  }
  if (vercelEnv) {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

/**
 * Pre-production Last War UID stubs for onboarding and manual QA.
 * Disabled on Vercel production; enabled on preview/dev and local non-prod builds.
 */
export function isUidBypassEnabled(): boolean {
  return isDevOrPreviewEnvironment();
}
