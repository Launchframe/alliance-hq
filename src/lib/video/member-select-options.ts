import type { AppSelectOption } from "@/components/ui/AppSelect";

type MemberLike = {
  id: string;
  current_name: string;
  previous_names?: string[];
};

type SelectedMemberLike = {
  memberId?: string | null;
  memberName?: string | null;
};

/**
 * Build Matched Member select options. Includes any currently selected members
 * that are missing from the roster list so cross-device review still shows labels.
 * Omits members already assigned to other rows (keeps this row's current match).
 */
export function buildMemberMatchSelectOptions(
  members: MemberLike[],
  config: {
    emptyLabel: string;
    highlightMemberId?: string | null;
    highlightConfidence?: number | null;
    /** Rows with a stored match that may not appear in `members`. */
    selectedMembers?: SelectedMemberLike[];
    /**
     * Member ids already assigned elsewhere. Still includes
     * `highlightMemberId` so the current row can keep / clear its match.
     */
    excludeMemberIds?: Iterable<string>;
  },
): AppSelectOption[] {
  const excluded = new Set<string>();
  for (const id of config.excludeMemberIds ?? []) {
    const trimmed = id.trim();
    if (trimmed) excluded.add(trimmed);
  }
  const keepId = config.highlightMemberId?.trim() || null;
  if (keepId) {
    excluded.delete(keepId);
  }

  const byId = new Map<string, MemberLike>();
  for (const member of members) {
    if (excluded.has(member.id)) continue;
    byId.set(member.id, member);
  }
  for (const selected of config.selectedMembers ?? []) {
    const id = selected.memberId?.trim();
    if (!id || byId.has(id) || excluded.has(id)) continue;
    const name = selected.memberName?.trim();
    if (!name) continue;
    byId.set(id, { id, current_name: name });
  }

  const ordered = [...byId.values()].sort((a, b) =>
    a.current_name.localeCompare(b.current_name, undefined, {
      sensitivity: "base",
    }),
  );

  return [
    {
      value: "",
      label: config.emptyLabel,
      searchText: config.emptyLabel,
    },
    ...ordered.map((member) => {
      const searchText = [
        member.current_name,
        ...(member.previous_names ?? []),
      ].join(" ");
      const confidenceSuffix =
        config.highlightMemberId === member.id &&
        config.highlightConfidence != null &&
        config.highlightConfidence < 1
          ? ` (${Math.round(config.highlightConfidence * 100)}%)`
          : "";
      return {
        value: member.id,
        label: `${member.current_name}${confidenceSuffix}`,
        searchText,
      };
    }),
  ];
}
