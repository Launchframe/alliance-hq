/**
 * Parse an LLM-provided due date string into a concrete timestamp when possible.
 */

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseActionItemDueDate(
  raw: string | null | undefined,
  referenceDate: Date = new Date(),
): { dueAt: Date | null; dueHint: string | null } {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return { dueAt: null, dueHint: null };
  }

  if (ISO_DATE_RE.test(trimmed)) {
    const normalized = trimmed.includes("T")
      ? trimmed
      : `${trimmed}T12:00:00.000Z`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return { dueAt: parsed, dueHint: null };
    }
  }

  const lower = trimmed.toLowerCase();
  const dayMs = 24 * 60 * 60 * 1000;
  if (lower === "today") {
    return { dueAt: endOfUtcDay(referenceDate), dueHint: null };
  }
  if (lower === "tomorrow") {
    return {
      dueAt: endOfUtcDay(new Date(referenceDate.getTime() + dayMs)),
      dueHint: null,
    };
  }

  return { dueAt: null, dueHint: trimmed };
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}
