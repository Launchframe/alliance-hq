import "server-only";

import { writeAuditLog } from "@/lib/bff/audit";
import type { OfficerAuditSeverity } from "@/lib/bff/officer-action-audit.shared";
import { TRAINS_WRITE_PERMISSION } from "@/lib/rbac/constants";

export type WriteOfficerActionAuditInput = {
  sessionId: string | null | undefined;
  allianceId: string | null | undefined;
  hqUserId: string | null | undefined;
  action: string;
  severity: OfficerAuditSeverity;
  permission: string;
  resourceType: string;
  resourceId?: string | null;
  resourceName?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Persist an officer-gated mutation. Fail-open so a logging outage cannot
 * roll back the officer's write.
 */
export async function writeOfficerActionAudit(
  input: WriteOfficerActionAuditInput,
): Promise<void> {
  try {
    await writeAuditLog({
      sessionId: input.sessionId ?? null,
      allianceId: input.allianceId ?? null,
      hqUserId: input.hqUserId ?? null,
      action: input.action,
      severity: input.severity,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      resourceName: input.resourceName ?? null,
      metadata: {
        permission: input.permission,
        ...input.metadata,
      },
    });
  } catch (error) {
    console.error("[officer-audit] write failed", {
      action: input.action,
      allianceId: input.allianceId,
      error,
    });
  }
}

export async function writeTrainsOfficerAudit(
  input: Omit<WriteOfficerActionAuditInput, "permission">,
): Promise<void> {
  await writeOfficerActionAudit({
    ...input,
    permission: TRAINS_WRITE_PERMISSION,
  });
}
