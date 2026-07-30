/**
 * Client-side Bank Strongholds list filter by map coordinates.
 * Searches active and Past drop deadline banks alike (caller filters the
 * full dashboard list before splitting sections).
 */

export type BankCoordSearchable = {
  coordX: number;
  coordY: number;
};

export type ParsedCoordQuery =
  | { kind: "empty" }
  | { kind: "xy"; x: number; y: number }
  | { kind: "single"; value: number };

/**
 * Parse flexible coordinate search text into a structured query.
 * Examples: "699 20", "699,20", "X:699 Y:20", "(699, 20)", "699".
 */
export function parseBankCoordQuery(raw: string): ParsedCoordQuery {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };

  const labeled = trimmed.match(
    /(?:x\s*[:=]?\s*)(\d+)\s*[,;\s]+(?:y\s*[:=]?\s*)(\d+)/i,
  );
  if (labeled) {
    return {
      kind: "xy",
      x: Number(labeled[1]),
      y: Number(labeled[2]),
    };
  }

  const paren = trimmed.match(/\(?\s*(\d+)\s*[,;\s]+\s*(\d+)\s*\)?/);
  if (paren) {
    return {
      kind: "xy",
      x: Number(paren[1]),
      y: Number(paren[2]),
    };
  }

  const digits = trimmed.match(/\d+/g);
  if (!digits || digits.length === 0) return { kind: "empty" };
  if (digits.length === 1) {
    return { kind: "single", value: Number(digits[0]) };
  }
  return {
    kind: "xy",
    x: Number(digits[0]),
    y: Number(digits[1]),
  };
}

export function bankMatchesCoordQuery(
  bank: BankCoordSearchable,
  query: string,
): boolean {
  const parsed = parseBankCoordQuery(query);
  switch (parsed.kind) {
    case "empty":
      return true;
    case "xy":
      return bank.coordX === parsed.x && bank.coordY === parsed.y;
    case "single":
      return bank.coordX === parsed.value || bank.coordY === parsed.value;
    default: {
      const _exhaustive: never = parsed;
      return _exhaustive;
    }
  }
}
