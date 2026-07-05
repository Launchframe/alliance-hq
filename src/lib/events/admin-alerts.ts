import postgres from "postgres";

import { isPostgresAuthError } from "@/lib/db/error-message";
import { getDatabaseUrl } from "@/lib/db/url";

export type VrLinkAttentionAlert = {
  type: "vr_link_attention";
  count: number;
  handles: string[];
  updatedAt: string;
};

export type MemberLinkUidTakenAlert = {
  type: "member_link_uid_taken";
  allianceId: string;
  allianceTag: string;
  ashedMemberId: string;
  hqUserId: string;
  handle: string;
  updatedAt: string;
};

export type MemberLinkClaimConflictAlert = {
  type: "member_link_claim_conflict";
  allianceId: string;
  allianceTag: string;
  /** Roster member the claim invite was bound to. */
  ashedMemberId: string;
  hqUserId: string;
  handle: string;
  /** Why the claim could not auto-complete. */
  reason:
    | "name_collision"
    | "commander_taken"
    | "server_mismatch"
    | "target_mismatch"
    | "discord_hq_unlinked";
  updatedAt: string;
};

export type AdminAlertEvent =
  | VrLinkAttentionAlert
  | MemberLinkUidTakenAlert
  | MemberLinkClaimConflictAlert;

export const ADMIN_ALERT_NOTIFY_CHANNEL = "hq_admin_alerts";

let notifyClient: ReturnType<typeof postgres> | null = null;
let notifyClientUrl: string | null = null;

function resetNotifyClient(): void {
  if (!notifyClient) {
    notifyClientUrl = null;
    return;
  }
  const stale = notifyClient;
  notifyClient = null;
  notifyClientUrl = null;
  void stale.end({ timeout: 0 }).catch(() => undefined);
}

function getNotifyClient() {
  const url = getDatabaseUrl();
  if (notifyClient && notifyClientUrl !== url) {
    resetNotifyClient();
  }
  if (!notifyClient) {
    notifyClientUrl = url;
    notifyClient = postgres(url, { prepare: false, max: 1 });
  }
  return notifyClient;
}

export function createAdminAlertListenClient() {
  return postgres(getDatabaseUrl(), { prepare: false, max: 1 });
}

export async function emitAdminAlert(
  payload:
    | (Omit<VrLinkAttentionAlert, "updatedAt"> & { updatedAt?: string })
    | (Omit<MemberLinkUidTakenAlert, "updatedAt"> & { updatedAt?: string })
    | (Omit<MemberLinkClaimConflictAlert, "updatedAt"> & {
        updatedAt?: string;
      }),
): Promise<void> {
  const event: AdminAlertEvent = {
    ...payload,
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
  } as AdminAlertEvent;
  try {
    const sql = getNotifyClient();
    await sql`SELECT pg_notify(${ADMIN_ALERT_NOTIFY_CHANNEL}, ${JSON.stringify(event)})`;
  } catch (error) {
    if (isPostgresAuthError(error)) {
      resetNotifyClient();
      try {
        const sql = getNotifyClient();
        await sql`SELECT pg_notify(${ADMIN_ALERT_NOTIFY_CHANNEL}, ${JSON.stringify(event)})`;
        return;
      } catch (retryError) {
        console.error("[admin-alerts] pg_notify failed after auth reset:", retryError);
        return;
      }
    }
    console.error("[admin-alerts] pg_notify failed:", error);
  }
}

export async function emitMemberLinkUidTakenAlert(input: {
  allianceId: string;
  allianceTag: string;
  ashedMemberId: string;
  hqUserId: string;
  handle: string;
}): Promise<void> {
  await emitAdminAlert({
    type: "member_link_uid_taken",
    allianceId: input.allianceId,
    allianceTag: input.allianceTag,
    ashedMemberId: input.ashedMemberId,
    hqUserId: input.hqUserId,
    handle: input.handle,
  });
}

export async function emitMemberLinkClaimConflictAlert(input: {
  allianceId: string;
  allianceTag: string;
  ashedMemberId: string;
  hqUserId: string;
  handle: string;
  reason: MemberLinkClaimConflictAlert["reason"];
}): Promise<void> {
  await emitAdminAlert({
    type: "member_link_claim_conflict",
    allianceId: input.allianceId,
    allianceTag: input.allianceTag,
    ashedMemberId: input.ashedMemberId,
    hqUserId: input.hqUserId,
    handle: input.handle,
    reason: input.reason,
  });
}

export function parseAdminAlertEvent(payload: string): AdminAlertEvent | null {
  try {
    const parsed = JSON.parse(payload) as AdminAlertEvent;
    if (
      parsed.type === "vr_link_attention" ||
      parsed.type === "member_link_uid_taken" ||
      parsed.type === "member_link_claim_conflict"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function adminAlertSseEventName(event: AdminAlertEvent): string {
  return event.type;
}
