import type { PlanSchedule, PlanOccurrence, ScheduleErrorCode } from "./schedule.shared";

export type PlanErrorCode = ScheduleErrorCode | "forbidden" | "linkRequired" | "commanderUnavailable" | "invalidColor" | "duplicate" | "stale" | "notFound" | "expired" | "channel" | "load" | "save" | "rateLimit";
export class PlunderPlanError extends Error {
  constructor(readonly code: PlanErrorCode, readonly status = 400) { super(code); }
}
export type PlanActor = { allianceId: string } & ({ kind: "web"; hqUserId: string; sessionId: string } | { kind: "discord"; discordUserId: string; guildId: string });
export type PlanSummary = {
  id: string;
  memberId: string | null;
  memberName: string;
  kind: "plan" | "suggestion";
  schedule: PlanSchedule;
  version: number;
  active: boolean;
  reminder: boolean;
  owned: boolean;
  color: string;
};
export type CalendarPlan = PlanOccurrence & { id: string; planId: string; memberName: string; color: string; kind: "plan" | "suggestion"; owned: boolean; version: number };
export type PlanDashboard = {
  version: number;
  canSuggest: boolean;
  commanders: { id: string; name: string }[];
  plans: PlanSummary[];
  occurrences: CalendarPlan[];
  suppressed: { planId: string; date: string; reason: "awayWeekly" | "awayOnce" | "dstSkipped" | "skippedLabel" }[];
  color: string;
  colorVersion: number;
};
export type PlanCommand =
  | { action: "create"; requestId: string; kind: "plan" | "suggestion"; memberId?: string; sourceId?: string; schedule: PlanSchedule; reminder: boolean }
  | { action: "edit"; requestId: string; id: string; expectedVersion: number; schedule: PlanSchedule; reminder: boolean }
  | { action: "pause" | "resume" | "remove"; requestId: string; id: string; expectedVersion: number }
  | { action: "skip" | "restore"; requestId: string; id: string; expectedVersion: number; date: string }
  | { action: "color"; requestId: string; color: string; expectedVersion: number };
