import type { AppSelectOption } from "@/components/ui/AppSelect";

type MemberLike = {
  id: string;
  current_name: string;
  previous_names?: string[];
};

export function buildMemberMatchSelectOptions(
  members: MemberLike[],
  config: {
    emptyLabel: string;
    highlightMemberId?: string | null;
    highlightConfidence?: number | null;
  },
): AppSelectOption[] {
  return [
    {
      value: "",
      label: config.emptyLabel,
      searchText: config.emptyLabel,
    },
    ...members.map((member) => {
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
