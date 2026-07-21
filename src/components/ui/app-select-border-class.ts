/** True when `className` already sets a Tailwind border-* color (not just `border`). */
export function hasBorderColorClass(className: string | undefined): boolean {
  if (!className) return false;
  // Exclude width/style/side utilities (border-2, border-t, border-solid, …).
  return /(?:^|\s)!?border-(?![\dxytrblse]\b|solid\b|dashed\b|dotted\b|double\b|none\b|hidden\b)[\w[\]#%./-]+/.test(
    className,
  );
}

export function withDefaultBorderColor(
  className: string,
  fallback = "border-hq-border",
): string {
  if (hasBorderColorClass(className)) {
    return className;
  }
  return `${className} ${fallback}`.trim();
}
