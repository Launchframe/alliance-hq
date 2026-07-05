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
 */
export function buildMemberMatchSelectOptions(
  members: MemberLike[],
  config: {
    emptyLabel: string;
    highlightMemberId?: string | null;
    highlightConfidence?: number | null;
    /** Rows with a stored match that may not appear in `members`. */
    selectedMembers?: SelectedMemberLike[];
  },
): AppSelectOption[] {
  const byId = new Map<string, MemberLike>();
  for (const member of members) {
    byId.set(member.id, member);
  }
  for (const selected of config.selectedMembers ?? []) {
    const id = selected.memberId?.trim();
    if (!id || byId.has(id)) continue;
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
