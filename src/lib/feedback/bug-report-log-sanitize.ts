const SENSITIVE_CONSOLE_PATTERNS: ReadonlyArray<
  readonly [pattern: RegExp, replacement: string]
> = [
  [
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    "[redacted-jwt]",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [
    /\b(token|api[_-]?key|password|secret|authorization|cookie)\b\s*[:=]\s*["']?[^"'&,\s]+["']?/gi,
    "$1=[redacted]",
  ],
  [
    /\b(set-cookie|x-api-key)\b\s*[:=]\s*["']?[^\s"'&,]+/gi,
    "$1=[redacted]",
  ],
];

export function sanitizeBugReportConsoleText(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of SENSITIVE_CONSOLE_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}
