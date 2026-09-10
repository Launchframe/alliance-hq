export type SearchableMemberScoreRow = {
  memberId: string;
  memberName: string;
};

export function filterMemberScoreRowsByName<T extends SearchableMemberScoreRow>(
  rows: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => row.memberName.toLowerCase().includes(needle));
}

export function paginateMemberScoreRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): {
  pageCount: number;
  safePage: number;
  pageRows: T[];
} {
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  return {
    pageCount,
    safePage,
    pageRows: rows.slice(safePage * size, safePage * size + size),
  };
}
