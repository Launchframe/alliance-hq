/** Route `/link` vs legacy combined slash options (pre–link-commander split). */
export function linkSlashUsesCommanderFlow(input: {
  hasHqLink: boolean;
  legacyName?: string;
}): boolean {
  return Boolean(input.hasHqLink && input.legacyName?.trim());
}
