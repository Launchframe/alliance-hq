"use client";

import { useMemo } from "react";

import { MemberPortrait } from "@/components/members/MemberPortrait";
import { Link } from "@/i18n/navigation";
import type { AshedMember } from "@/lib/video/member-matcher";
import {
  formatMemberRankDisplay,
  parseAshedMemberAllianceRank,
} from "@/lib/members/alliance-rank";

type Props = {
  members: AshedMember[];
  allianceTag: string;
  searchQuery: string;
  showFormer: boolean;
  emptyLabel: string;
  rankUnknownLabel: string;
};

function memberMatchesQuery(member: AshedMember, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (member.current_name.toLowerCase().includes(q)) return true;
  return (member.previous_names ?? []).some((name) =>
    name.toLowerCase().includes(q),
  );
}

export function MembersGalleryView({
  members,
  allianceTag,
  searchQuery,
  showFormer,
  emptyLabel,
  rankUnknownLabel,
}: Props) {
  const filtered = useMemo(() => {
    const q = searchQuery.trim();
    return members.filter((member) => {
      if (!showFormer && member.status === "former") return false;
      return memberMatchesQuery(member, q);
    });
  }, [members, searchQuery, showFormer]);

  if (filtered.length === 0) {
    return (
      <p className="rounded-xl border border-[#30363d] bg-[#161b22] px-4 py-10 text-center text-sm text-[#8b949e]">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {filtered.map((member) => {
        const { rankLabel } = formatMemberRankDisplay(
          parseAshedMemberAllianceRank(member),
          rankUnknownLabel,
        );
        return (
          <Link
            key={member.id}
            href={`/members/${member.id}`}
            className="group flex min-w-0 flex-col items-center gap-2 rounded-xl border border-[#30363d] bg-[#161b22] p-3 text-center transition hover:border-[#58a6ff]/40 hover:bg-[#1c2128]"
          >
            <MemberPortrait
              allianceTag={allianceTag}
              memberId={member.id}
              memberName={member.current_name}
              size="lg"
              eager
            />
            <div className="min-w-0 w-full">
              <p className="truncate text-sm font-medium text-[#e6edf3] group-hover:text-[#58a6ff]">
                {member.current_name}
              </p>
              <p className="mt-0.5 truncate text-xs text-[#8b949e]">
                {rankLabel}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
