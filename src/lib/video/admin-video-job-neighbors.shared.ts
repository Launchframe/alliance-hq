/**
 * Given job ids in the same order as the admin video jobs index
 * (upload groups clustered, primary before shadow), return adjacent ids
 * for detail navigation.
 */
export function findAdminVideoJobNeighborIds(
  orderedIds: readonly string[],
  currentId: string,
): { previousId: string | null; nextId: string | null } {
  const index = orderedIds.indexOf(currentId);
  if (index < 0) {
    return { previousId: null, nextId: null };
  }
  return {
    previousId: index > 0 ? (orderedIds[index - 1] ?? null) : null,
    nextId:
      index < orderedIds.length - 1 ? (orderedIds[index + 1] ?? null) : null,
  };
}
