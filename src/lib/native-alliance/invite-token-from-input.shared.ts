/**
 * Extract an HQ invite token from a pasted invite URL or bare token.
 * Claim links look like `/invite/<token>`; join codes are short alphanumerics.
 */
export function extractHqInviteToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/\/invite\/([^/?#]+)/i);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  } catch {
    // Not a full URL — try path-shaped or bare token input below.
  }

  const pathMatch = trimmed.match(/(?:^|\/)invite\/([^/?#\s]+)/i);
  if (pathMatch?.[1]) {
    return decodeURIComponent(pathMatch[1]);
  }

  // Invite tokens are base64url from 32 random bytes (~43 chars). Join codes are
  // short (typically 6–12). Avoid treating join codes as invite tokens.
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}
