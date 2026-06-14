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

export function normalizeTranslationText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function splitIcuTemplate(template: string): string[] {
  const parts: string[] = [];
  let current = "";
  let i = 0;
  while (i < template.length) {
    if (template[i] === "{") {
      if (current) {
        parts.push(current);
        current = "";
      }
      let depth = 1;
      i += 1;
      while (i < template.length && depth > 0) {
        if (template[i] === "{") depth += 1;
        if (template[i] === "}") depth -= 1;
        i += 1;
      }
      continue;
    }
    current += template[i];
    i += 1;
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

/** Remove ICU placeholder blocks like `{name}` or `{days, plural, ...}`. */
export function stripIcuPlaceholders(template: string): string {
  return normalizeTranslationText(splitIcuTemplate(template).join(" "));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function translationTemplateMatchesDisplay(
  template: string,
  display: string,
): boolean {
  const normDisplay = normalizeTranslationText(display);
  const normTemplate = normalizeTranslationText(template);
  if (!normDisplay || normDisplay.length < 2) {
    return false;
  }
  if (normTemplate === normDisplay) {
    return true;
  }

  if (normTemplate.includes(normDisplay)) {
    return true;
  }

  const stripped = stripIcuPlaceholders(normTemplate);
  if (stripped.length >= 2) {
    if (stripped.includes(normDisplay) || normDisplay.includes(stripped)) {
      return true;
    }
  }

  const parts = splitIcuTemplate(normTemplate);
  if (parts.some((part) => part.length >= 2 && normDisplay.includes(part))) {
    return true;
  }

  const regexSource = parts.map(escapeRegExp).join(".+?");
  if (!regexSource) {
    return false;
  }

  try {
    const re = new RegExp(`^${regexSource}$`);
    return re.test(normDisplay);
  } catch {
    return false;
  }
}

export function resolveTranslationKeysFromClient(
  messages: Record<string, unknown>,
  displayedText: string,
): { i18nKey: string | null; candidateKeys: string[] } {
  const normalized = normalizeTranslationText(displayedText);
  if (!normalized) {
    return { i18nKey: null, candidateKeys: [] };
  }

  const flat = flattenMessages(messages);
  const matches = flat
    .filter((entry) =>
      translationTemplateMatchesDisplay(entry.value, normalized),
    )
    .map((entry) => entry.key);

  return {
    i18nKey: matches.length === 1 ? matches[0] : null,
    candidateKeys: matches,
  };
}

export function mergeServerTranslationKeyResolution(
  serverResolved: { i18nKey: string | null; candidateKeys: string[] },
  clientKey?: string | null,
): { i18nKey: string | null; candidateKeys: string[] } {
  const candidateKeys =
    serverResolved.candidateKeys.length > 0
      ? serverResolved.candidateKeys
      : clientKey
        ? [clientKey]
        : [];

  if (serverResolved.i18nKey) {
    return { i18nKey: serverResolved.i18nKey, candidateKeys };
  }

  if (
    clientKey &&
    candidateKeys.includes(clientKey) &&
    candidateKeys.length === 1
  ) {
    return { i18nKey: clientKey, candidateKeys };
  }

  return { i18nKey: null, candidateKeys };
}
