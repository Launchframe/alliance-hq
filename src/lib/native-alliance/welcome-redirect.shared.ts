/**
 * Map legacy/shared `/welcome` query params (PR #210 URL builders) onto the
 * existing recipient routes until a richer welcome funnel exists.
 *
 * - `?invite=` → `/invite/<token>`
 * - `?code=` (+ optional `tag=`) → `/join?code=`
 * - otherwise → `/get-started`
 */
export function resolveWelcomeRedirect(input: {
  invite?: string | null;
  code?: string | null;
  tag?: string | null;
}): string {
  const invite = input.invite?.trim() ?? "";
  if (invite) {
    // Invite tokens are base64url; reject anything that could reshape the path.
    if (/^[A-Za-z0-9_-]+$/.test(invite)) {
      return `/invite/${encodeURIComponent(invite)}`;
    }
    return "/get-started";
  }

  const code = input.code?.trim() ?? "";
  if (code) {
    return `/join?code=${encodeURIComponent(code)}`;
  }

  return "/get-started";
}
