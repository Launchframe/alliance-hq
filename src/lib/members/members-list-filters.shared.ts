export const MEMBERS_LIST_FILTERS_KEY = "members-list-filters";

export type MembersListFilters = {
  searchInput: string;
  showFormer: boolean;
};

export function readStoredMembersListFilters(): MembersListFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(MEMBERS_LIST_FILTERS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MembersListFilters>;
    return {
      searchInput:
        typeof parsed.searchInput === "string" ? parsed.searchInput : "",
      showFormer: parsed.showFormer === true,
    };
  } catch {
    return null;
  }
}

export function writeStoredMembersListFilters(filters: MembersListFilters): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(MEMBERS_LIST_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    /* ignore quota / private mode */
  }
}

export function membersListHrefFromFilters(
  filters: MembersListFilters | null,
): string {
  if (!filters) return "/members";
  const params = new URLSearchParams();
  const q = filters.searchInput.trim();
  if (q) params.set("q", q);
  if (filters.showFormer) params.set("former", "1");
  const qs = params.toString();
  return qs ? `/members?${qs}` : "/members";
}
