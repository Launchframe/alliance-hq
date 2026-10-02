import type { TeamWorkDetail } from "./work-routing.shared";

export const OFFICER_WORK_QUEUE_KINDS = ["coverage", "vs"] as const;
export type OfficerWorkQueueKind = (typeof OFFICER_WORK_QUEUE_KINDS)[number];

export type TeamWorkDashboardItem = {
  id: string;
  memberId: string;
  kind: OfficerWorkQueueKind;
  teamId: string | null;
  detail: TeamWorkDetail;
  href: string;
  assigneeName: string | null;
  leadName: string | null;
  leadUnlinked: boolean;
  leadAway: boolean;
};

export type TeamWorkDashboardTeam = {
  id: string;
  name: string | null;
  leadName: string | null;
};

export type TeamWorkDashboard = {
  teams: TeamWorkDashboardTeam[];
  items: TeamWorkDashboardItem[];
  canReview: boolean;
};

export function isOfficerWorkQueueKind(kind: string): kind is OfficerWorkQueueKind {
  return (OFFICER_WORK_QUEUE_KINDS as readonly string[]).includes(kind);
}

export function isOfficerWorkQueueItem<T extends { kind: string }>(item: T): item is T & { kind: OfficerWorkQueueKind } {
  return isOfficerWorkQueueKind(item.kind);
}

export function filterOfficerWorkQueueItems(
  items: TeamWorkDashboardItem[],
  options: { team?: string; kind?: string } = {},
): TeamWorkDashboardItem[] {
  return items.filter((item) => isOfficerWorkQueueKind(item.kind) && (!options.team || item.teamId === options.team) && (!options.kind || item.kind === options.kind));
}

export function workQueueShowsEmpty(loaded: boolean, filteredCount: number): boolean {
  return loaded && filteredCount === 0;
}
