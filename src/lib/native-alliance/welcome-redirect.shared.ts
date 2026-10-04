/**
 * Map legacy/shared `/welcome` query params (PR #210 URL builders) onto the
 * existing recipient routes until a richer welcome funnel exists.
 *
 * - `?invite=` (+ optional `p=` passphrase) → `/invite/<token>?p=`
 * - `?code=` (+ optional `tag=`) → `/join?code=`
 * - otherwise → `/get-started`
 */
export function resolveWelcomeRedirect(input: {
  invite?: string | null;
  code?: string | null;
  tag?: string | null;
  /** Protected-link passphrase embedded in the share URL. */
  p?: string | null;
}): string {
  const invite = input.invite?.trim() ?? "";
  if (invite) {
    // Invite tokens are base64url; reject anything that could reshape the path.
    if (/^[A-Za-z0-9_-]+$/.test(invite)) {
      const path = `/invite/${encodeURIComponent(invite)}`;
      const passphrase = input.p?.trim() ?? "";
      if (!passphrase) {
        return path;
      }
      return `${path}?p=${encodeURIComponent(passphrase)}`;
    }
    return "/get-started";
  }

  const code = input.code?.trim() ?? "";
  if (code) {
    return `/join?code=${encodeURIComponent(code)}`;
  }

  return "/get-started";
}
