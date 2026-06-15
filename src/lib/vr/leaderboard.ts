import type { AshedMember } from "@/lib/video/member-matcher";

import type { MemberSeasonVr } from "@/lib/db/schema";

export type LeaderboardRow = {
  ashedMemberId: string;
  memberName: string;
  highestBaseVr: number;
  totalHeroPower: number;
  flagged: boolean;
  flagReason: string | null;
};

export function memberTotalHeroPower(member: AshedMember): number {
  const record = member as AshedMember & {
    total_hero_power?: number;
    totalHeroPower?: number;
    hero_power?: number;
  };
  return (
    record.total_hero_power ??
    record.totalHeroPower ??
    record.hero_power ??
    0
  );
}

export function buildLeaderboardRows(
  seasonRows: MemberSeasonVr[],
  members: AshedMember[],
  links: Array<{ ashedMemberId: string; memberDisplayName: string | null }>,
): LeaderboardRow[] {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const linkNameById = new Map(
    links.map((l) => [l.ashedMemberId, l.memberDisplayName]),
  );

  return seasonRows
    .map((row) => {
      const member = memberById.get(row.ashedMemberId);
      const memberName =
        linkNameById.get(row.ashedMemberId) ??
        member?.current_name ??
        row.ashedMemberId;
      return {
        ashedMemberId: row.ashedMemberId,
        memberName,
        highestBaseVr: row.highestBaseVr,
        totalHeroPower: member ? memberTotalHeroPower(member) : 0,
        flagged: row.flaggedAt != null,
        flagReason: row.flagReason,
      };
    })
    .sort((a, b) => {
      if (b.highestBaseVr !== a.highestBaseVr) {
        return b.highestBaseVr - a.highestBaseVr;
      }
      return b.totalHeroPower - a.totalHeroPower;
    });
}

export function formatDailyDiscordReport(rows: LeaderboardRow[], seasonKey: string): string {
  if (rows.length === 0) {
    return `**Season ${seasonKey} VR report** — no reports yet today.`;
  }
  const lines = rows.slice(0, 25).map((row, index) => {
    const flag = row.flagged ? " ⚠️" : "";
    return `${index + 1}. **${row.memberName}** — ${row.highestBaseVr} VR (THP ${row.totalHeroPower.toLocaleString()})${flag}`;
  });
  return [`**Season ${seasonKey} base VR standings**`, ...lines].join("\n");
}
