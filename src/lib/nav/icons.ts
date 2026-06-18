import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  ClipboardList,
  Database,
  ExternalLink,
  FileText,
  Flame,
  GitMerge,
  LayoutDashboard,
  Mountain,
  Settings,
  Shield,
  Skull,
  Star,
  Train,
  Upload,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";

/** Unique lucide icon per sidebar nav page id */
export const NAV_PAGE_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  alliances: Users,
  members: Users,
  "waiting-list": ClipboardList,
  "alliance-tasks": ClipboardList,
  "merge-manager": GitMerge,
  "vs-performance": BarChart3,
  donations: Wallet,
  "alliance-exercise": Flame,
  reports: FileText,
  "viral-resistance": Shield,
  trains: Train,
  "desert-storm": Mountain,
  "canyon-storm": Mountain,
  "other-events": Star,
  "zombie-siege": Skull,
  "data-management": Database,
  "unmatched-names": UserCog,
  "video-upload": Upload,
  settings: Settings,
  team: UserCog,
  "admin-portal": Shield,
  "open-ashed": ExternalLink,
};

export function navPageIcon(pageId: string): LucideIcon | undefined {
  return NAV_PAGE_ICONS[pageId];
}
