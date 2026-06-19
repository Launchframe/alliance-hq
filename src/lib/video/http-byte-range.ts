export type ParsedByteRange = {
  start: number;
  end: number;
};

/** Parse a `Range: bytes=…` header against a known object size. */
export function parseBytesRangeHeader(
  rangeHeader: string | null,
  size: number,
): ParsedByteRange | null | "unsatisfiable" {
  if (!rangeHeader?.startsWith("bytes=")) {
    return null;
  }

  if (size <= 0) {
    return "unsatisfiable";
  }

  const spec = rangeHeader.slice("bytes=".length).trim();
  const dash = spec.indexOf("-");
  if (dash === -1) {
    return "unsatisfiable";
  }

  const startPart = spec.slice(0, dash);
  const endPart = spec.slice(dash + 1);

  let start: number;
  let end: number;

  if (startPart === "") {
    // suffix range: bytes=-500
    const suffixLength = Number(endPart);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return "unsatisfiable";
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startPart);
    end = endPart === "" ? size - 1 : Number(endPart);
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "unsatisfiable";
  }

  end = Math.min(end, size - 1);
  return { start, end };
}
