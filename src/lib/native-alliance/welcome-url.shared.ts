export function normalizeAllianceTagForUrl(tag: string | null | undefined): string {
  const trimmed = tag?.trim() ?? "";
  return trimmed || "HQ";
}

export function buildWelcomeJoinCodeUrl(
  origin: string,
  tag: string | null | undefined,
  code: string,
): string {
  const base = origin.replace(/\/$/, "");
  const params = new URLSearchParams({
    tag: normalizeAllianceTagForUrl(tag),
    code: code.trim(),
  });
  return `${base}/welcome?${params.toString()}`;
}

export function buildWelcomeInviteUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "");
  const params = new URLSearchParams({
    invite: token.trim(),
  });
  return `${base}/welcome?${params.toString()}`;
}

export function extractInviteTokenFromAcceptUrl(inviteUrl: string): string | null {
  try {
    const url = new URL(inviteUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const inviteIndex = parts.indexOf("invite");
    if (inviteIndex === -1 || inviteIndex + 1 >= parts.length) {
      return null;
    }
    return decodeURIComponent(parts[inviteIndex + 1] ?? "");
  } catch {
    return null;
  }
}
