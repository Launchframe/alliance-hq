export function safeVisibleName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().slice(0, 160);
  if (!trimmed || trimmed.includes("@") || /[0-9]{12,16}/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function safeActivityServerNumber(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^\d{1,8}$/.test(trimmed) ? trimmed : null;
}
