/**
 * Dev/preview-only feature gate for the test-matrix quick-switch tooling.
 *
 * Client-safe (no server imports) so the shell can gate the panel and the API
 * route can 404 with the same predicate.
 *
 * - On Vercel: enabled for every deployment except `production`.
 * - Locally: enabled unless this is a production build (`NODE_ENV=production`).
 */
export function isDevOrPreviewEnvironment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv) {
    return vercelEnv !== "production";
  }
  return process.env.NODE_ENV !== "production";
}
