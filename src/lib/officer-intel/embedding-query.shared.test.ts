import { describe, expect, it } from "vitest";

import {
  formatOfficerIntelEmbeddingLiteral,
  OFFICER_INTEL_EMBEDDING_DIMS,
} from "@/lib/officer-intel/embedding-query.shared";

describe("formatOfficerIntelEmbeddingLiteral", () => {
  it("formats a finite 1536-d vector for pgvector", () => {
    const values = Array.from({ length: OFFICER_INTEL_EMBEDDING_DIMS }, (_, i) =>
      i === 0 ? 0.25 : 0,
    );
    expect(formatOfficerIntelEmbeddingLiteral(values)).toBe(
      `[${values.join(",")}]`,
    );
  });

  it("rejects empty, wrong-length, and non-finite values", () => {
    expect(() => formatOfficerIntelEmbeddingLiteral([])).toThrow(
      "invalid query embedding",
    );
    expect(() => formatOfficerIntelEmbeddingLiteral([1, 2, 3])).toThrow(
      "invalid query embedding",
    );
    const nan = Array.from({ length: OFFICER_INTEL_EMBEDDING_DIMS }, () => 0);
    nan[4] = Number.NaN;
    expect(() => formatOfficerIntelEmbeddingLiteral(nan)).toThrow(
      "invalid query embedding",
    );
    const inf = Array.from({ length: OFFICER_INTEL_EMBEDDING_DIMS }, () => 0);
    inf[4] = Number.POSITIVE_INFINITY;
    expect(() => formatOfficerIntelEmbeddingLiteral(inf)).toThrow(
      "invalid query embedding",
    );
  });
});
