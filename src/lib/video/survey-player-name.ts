/** Never use email-shaped strings as the personalized Q3 player name. */
export function isEmailShaped(value: string): boolean {
  return value.includes("@");
}

/**
 * Resolve a safe display name for the survey Q3 personalization line.
 * Order: Ashed full_name → HQ displayName → null (generic Q3 copy).
 */
export function resolveSurveyPlayerNameFromSources(
  fullName: string | null | undefined,
  displayName: string | null | undefined,
): string | null {
  const fromFull = fullName?.trim();
  if (fromFull && !isEmailShaped(fromFull)) {
    return fromFull;
  }

  const fromDisplay = displayName?.trim();
  if (fromDisplay && !isEmailShaped(fromDisplay)) {
    return fromDisplay;
  }

  return null;
}
