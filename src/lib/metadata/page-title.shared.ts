export type PageTitleFormatOptions = {
  allianceTag?: string | null;
  admin?: boolean;
};

/** Browser tab title segment before the locale layout's " · Alliance HQ" suffix. */
export function formatContextAwarePageTitle(
  pageTitle: string,
  options?: PageTitleFormatOptions,
): string {
  const trimmed = pageTitle.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (options?.admin) {
    return `Admin ${trimmed}`;
  }

  const tag = options?.allianceTag?.trim();
  if (tag) {
    return `${tag} ${trimmed}`;
  }

  return trimmed;
}

export function formatVideoJobPageTitle(jobLabel: string): string {
  const label = jobLabel.trim();
  if (!label) {
    return "Video";
  }
  return `Video ${label}`;
}
