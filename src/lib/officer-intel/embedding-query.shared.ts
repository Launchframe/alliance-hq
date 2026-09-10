/** text-embedding-3-small / pgvector column width. */
export const OFFICER_INTEL_EMBEDDING_DIMS = 1536;

export function formatOfficerIntelEmbeddingLiteral(values: number[]): string {
  if (values.length !== OFFICER_INTEL_EMBEDDING_DIMS) {
    throw new Error("invalid query embedding");
  }
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("invalid query embedding");
  }
  return `[${values.join(",")}]`;
}
