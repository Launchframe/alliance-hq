function flattenMessages(
  obj: Record<string, unknown>,
  prefix = "",
): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      entries.push({ key: nextKey, value: v });
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      entries.push(
        ...flattenMessages(v as Record<string, unknown>, nextKey),
      );
    }
  }
  return entries;
}

export function resolveTranslationKeysFromClient(
  messages: Record<string, unknown>,
  displayedText: string,
): { i18nKey: string | null; candidateKeys: string[] } {
  const normalized = displayedText.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { i18nKey: null, candidateKeys: [] };
  }

  const flat = flattenMessages(messages);
  const matches = flat
    .filter((entry) => entry.value.trim() === normalized)
    .map((entry) => entry.key);

  return {
    i18nKey: matches.length === 1 ? matches[0] : null,
    candidateKeys: matches,
  };
}
