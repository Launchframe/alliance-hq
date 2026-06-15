export class I18nKeyNotFoundError extends Error {
  constructor(key: string) {
    super(`i18n key "${key}" does not exist`);
    this.name = "I18nKeyNotFoundError";
  }
}

export class I18nKeyNotStringLeafError extends Error {
  constructor(key: string) {
    super(`i18n key "${key}" is not a string leaf`);
    this.name = "I18nKeyNotStringLeafError";
  }
}

export function getNestedMessageValue(
  root: Record<string, unknown>,
  dotKey: string,
): unknown {
  const parts = dotKey.split(".");
  let current: unknown = root;
  for (const part of parts) {
    if (
      typeof current !== "object" ||
      current === null ||
      !(part in (current as Record<string, unknown>))
    ) {
      throw new I18nKeyNotFoundError(dotKey);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setNestedMessageValue(
  root: Record<string, unknown>,
  dotKey: string,
  value: string,
): void {
  const parts = dotKey.split(".");
  let current: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      typeof current !== "object" ||
      current === null ||
      !(part in (current as Record<string, unknown>))
    ) {
      throw new I18nKeyNotFoundError(dotKey);
    }
    current = (current as Record<string, unknown>)[part];
  }

  const leaf = parts[parts.length - 1];
  if (
    typeof current !== "object" ||
    current === null ||
    !(leaf in (current as Record<string, unknown>))
  ) {
    throw new I18nKeyNotFoundError(dotKey);
  }

  const existing = (current as Record<string, unknown>)[leaf];
  if (typeof existing !== "string") {
    throw new I18nKeyNotStringLeafError(dotKey);
  }

  (current as Record<string, unknown>)[leaf] = value;
}
