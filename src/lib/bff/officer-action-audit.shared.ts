export const OFFICER_AUDIT_SEVERITIES = [
  "routine",
  "update",
  "override",
] as const;

export type OfficerAuditSeverity = (typeof OFFICER_AUDIT_SEVERITIES)[number];

export function isOfficerAuditSeverity(
  value: string,
): value is OfficerAuditSeverity {
  return (OFFICER_AUDIT_SEVERITIES as readonly string[]).includes(value);
}
