export type HqLinkProgressCounts = {
  linked: number;
  unlinked: number;
  total: number;
};

export function computeActiveHqLinkCounts(input: {
  members: Array<{
    id?: string;
    ashed_member_id?: string;
    status?: string | null;
  }>;
  commanderRows: Array<{ ashedMemberId: string; hqLinked: boolean }>;
}): HqLinkProgressCounts {
  const activeIds = new Set(
    input.members
      .filter((member) => member.status !== "former")
      .map((member) => member.ashed_member_id ?? member.id ?? "")
      .filter(Boolean),
  );

  let linked = 0;
  let unlinked = 0;
  for (const row of input.commanderRows) {
    if (!activeIds.has(row.ashedMemberId)) {
      continue;
    }
    if (row.hqLinked) {
      linked += 1;
    } else {
      unlinked += 1;
    }
  }

  return { linked, unlinked, total: linked + unlinked };
}
