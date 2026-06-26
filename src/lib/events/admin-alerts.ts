import postgres from "postgres";

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

export type AdminAlertEvent = VrLinkAttentionAlert | MemberLinkUidTakenAlert;

export const ADMIN_ALERT_NOTIFY_CHANNEL = "hq_admin_alerts";

let notifyClient: ReturnType<typeof postgres> | null = null;

function getNotifyClient() {
  if (!notifyClient) {
    notifyClient = postgres(getDatabaseUrl(), { prepare: false, max: 1 });
  }
  return notifyClient;
}

export function createAdminAlertListenClient() {
  return postgres(getDatabaseUrl(), { prepare: false, max: 1 });
}

export async function emitAdminAlert(
  payload:
    | (Omit<VrLinkAttentionAlert, "updatedAt"> & { updatedAt?: string })
    | (Omit<MemberLinkUidTakenAlert, "updatedAt"> & { updatedAt?: string }),
): Promise<void> {
  const event: AdminAlertEvent = {
    ...payload,
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
  } as AdminAlertEvent;
  try {
    const sql = getNotifyClient();
    await sql`SELECT pg_notify(${ADMIN_ALERT_NOTIFY_CHANNEL}, ${JSON.stringify(event)})`;
  } catch (error) {
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

export function parseAdminAlertEvent(payload: string): AdminAlertEvent | null {
  try {
    const parsed = JSON.parse(payload) as AdminAlertEvent;
    if (
      parsed.type === "vr_link_attention" ||
      parsed.type === "member_link_uid_taken"
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
