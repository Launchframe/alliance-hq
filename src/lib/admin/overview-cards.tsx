import type { LucideIcon } from "lucide-react";
import {
  Award,
  Bug,
  Building2,
  CalendarDays,
  Languages,
  MessageSquareText,
  ScrollText,
  Server,
  Swords,
  Users,
  Video,
} from "lucide-react";

export type AdminOverviewCard = {
  href: string;
  titleKey:
    | "systemTitle"
    | "alliancesTitle"
    | "usersTitle"
    | "commandersTitle"
    | "auditTitle"
    | "videoJobsTitle"
    | "hqEventsTitle"
    | "commendationsTitle"
    | "bugReportsTitle"
    | "experienceFeedbackTitle"
    | "translationReportsTitle";
  descKey:
    | "systemDesc"
    | "alliancesDesc"
    | "usersDesc"
    | "commandersDesc"
    | "auditDesc"
    | "videoJobsDesc"
    | "hqEventsDesc"
    | "commendationsDesc"
    | "bugReportsDesc"
    | "experienceFeedbackDesc"
    | "translationReportsDesc";
  icon: LucideIcon;
};

export const ADMIN_OVERVIEW_CARDS: AdminOverviewCard[] = [
  {
    href: "/admin/system",
    titleKey: "systemTitle",
    descKey: "systemDesc",
    icon: Server,
  },
  {
    href: "/admin/alliances",
    titleKey: "alliancesTitle",
    descKey: "alliancesDesc",
    icon: Building2,
  },
  {
    href: "/admin/users",
    titleKey: "usersTitle",
    descKey: "usersDesc",
    icon: Users,
  },
  {
    href: "/admin/commanders",
    titleKey: "commandersTitle",
    descKey: "commandersDesc",
    icon: Swords,
  },
  {
    href: "/admin/audit",
    titleKey: "auditTitle",
    descKey: "auditDesc",
    icon: ScrollText,
  },
  {
    href: "/admin/video-jobs",
    titleKey: "videoJobsTitle",
    descKey: "videoJobsDesc",
    icon: Video,
  },
  {
    href: "/admin/hq-events",
    titleKey: "hqEventsTitle",
    descKey: "hqEventsDesc",
    icon: CalendarDays,
  },
  {
    href: "/admin/commendations",
    titleKey: "commendationsTitle",
    descKey: "commendationsDesc",
    icon: Award,
  },
  {
    href: "/admin/bug-reports",
    titleKey: "bugReportsTitle",
    descKey: "bugReportsDesc",
    icon: Bug,
  },
  {
    href: "/admin/experience-feedback",
    titleKey: "experienceFeedbackTitle",
    descKey: "experienceFeedbackDesc",
    icon: MessageSquareText,
  },
  {
    href: "/admin/translation-reports",
    titleKey: "translationReportsTitle",
    descKey: "translationReportsDesc",
    icon: Languages,
  },
];

export function AdminOverviewCardIcon({
  icon: Icon,
}: {
  icon: LucideIcon;
}) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#30363d] bg-[#0d1117] text-[#58a6ff]">
      <Icon className="h-5 w-5" aria-hidden />
    </span>
  );
}
