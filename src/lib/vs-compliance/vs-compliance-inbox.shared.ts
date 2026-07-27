import {
  VS_DEMOTION_TASK_KIND,
  VS_KICK_TASK_KIND,
  type VsComplianceTaskKind,
} from "@/lib/vs-compliance/evaluate.shared";

export { VS_DEMOTION_TASK_KIND, VS_KICK_TASK_KIND };
export type { VsComplianceTaskKind };

/** Officers demote/kick in-game; this task is a read-only reminder + Mark complete / Waive. */
export const VS_COMPLIANCE_INBOX_KINDS: readonly VsComplianceTaskKind[] = [
  VS_DEMOTION_TASK_KIND,
  VS_KICK_TASK_KIND,
];

export function isVsComplianceInboxKind(
  kind: string,
): kind is VsComplianceTaskKind {
  return (VS_COMPLIANCE_INBOX_KINDS as readonly string[]).includes(kind);
}

export function vsComplianceTaskHref(eventId: string): string {
  return `/vs-compliance?event=${encodeURIComponent(eventId)}`;
}
