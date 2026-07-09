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
