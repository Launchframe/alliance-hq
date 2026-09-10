export type WorkRecipient = {
  id: string;
  allianceId: string;
  name: string | null;
  role: string;
  permissions: string[];
  memberIds: string[];
  active: boolean;
};

export function eligibleWorkRecipient(recipient: WorkRecipient, allianceId: string, permission: string): boolean {
  return recipient.active && recipient.allianceId === allianceId &&
    ["owner", "maintainer", "officer"].includes(recipient.role) && recipient.permissions.includes(permission);
}

export function routeTeamWork(input: { allianceId: string; permission: string; leadMemberId: string | null; recipients: WorkRecipient[]; awayMemberIds: string[] }) {
  const eligible = input.recipients.filter((recipient) => eligibleWorkRecipient(recipient, input.allianceId, input.permission) && !recipient.memberIds.some((id) => input.awayMemberIds.includes(id)));
  const lead = input.leadMemberId ? eligible.find((recipient) => recipient.memberIds.includes(input.leadMemberId!)) : null;
  const fallback = [...eligible].sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.id.localeCompare(b.id))[0];
  const selected = lead ?? fallback;
  return { assigneeId: selected?.id ?? null, assigneeName: selected?.name ?? null, routing: lead ? "team_lead" as const : "alliance_leadership" as const };
}

export function canViewTeamWork(work: { allianceId: string; assigneeId: string | null; requiredPermission: string }, viewer: WorkRecipient, personal: boolean): boolean {
  return eligibleWorkRecipient(viewer, work.allianceId, work.requiredPermission) && (!personal || work.assigneeId === viewer.id);
}

export type TeamWorkDetail = {
  memberName: string;
  date: string;
  endDate?: string;
  unexpected?: boolean;
  dutyRole?: "conductor" | "vip" | "engineer";
  outcome?: "passed" | "excused" | "waived" | "missed" | "pending_data" | "not_eligible";
  evidenceState?: "ready" | "missing" | "partial" | "conflict";
  dailyCoverage?: number;
  recommendation?: { kind: "none" | "demote" | "remove" | "leadership_review"; targetRank: number | null };
};
