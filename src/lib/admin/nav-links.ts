export const ADMIN_LINKS = [
  { href: "/admin", labelKey: "overview" as const },
  { href: "/admin/system", labelKey: "system" as const },
  { href: "/admin/alliances", labelKey: "alliances" as const },
  { href: "/admin/users", labelKey: "users" as const },
  { href: "/admin/audit", labelKey: "audit" as const },
  { href: "/admin/video-jobs", labelKey: "videoJobs" as const },
  { href: "/admin/hq-events", labelKey: "hqEvents" as const },
  { href: "/admin/commendations", labelKey: "commendations" as const },
  { href: "/admin/bug-reports", labelKey: "bugReports" as const },
  { href: "/admin/experience-feedback", labelKey: "experienceFeedback" as const },
  { href: "/admin/translation-reports", labelKey: "translationReports" as const },
];

export type AdminNavLabelKey = (typeof ADMIN_LINKS)[number]["labelKey"];
