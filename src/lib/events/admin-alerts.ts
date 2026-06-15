import postgres from "postgres";

import { getDatabaseUrl } from "@/lib/db/url";

export type AdminAlertEvent = {
  type: "vr_link_attention";
  count: number;
  handles: string[];
  updatedAt: string;
};

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
  payload: Omit<AdminAlertEvent, "updatedAt"> & { updatedAt?: string },
): Promise<void> {
  const event: AdminAlertEvent = {
    ...payload,
    updatedAt: payload.updatedAt ?? new Date().toISOString(),
  };
  try {
    const sql = getNotifyClient();
    await sql`SELECT pg_notify(${ADMIN_ALERT_NOTIFY_CHANNEL}, ${JSON.stringify(event)})`;
  } catch (error) {
    console.error("[admin-alerts] pg_notify failed:", error);
  }
}

export function parseAdminAlertEvent(payload: string): AdminAlertEvent | null {
  try {
    const parsed = JSON.parse(payload) as AdminAlertEvent;
    if (parsed.type !== "vr_link_attention") return null;
    return parsed;
  } catch {
    return null;
  }
}
