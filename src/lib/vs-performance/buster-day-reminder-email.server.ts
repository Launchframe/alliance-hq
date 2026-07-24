import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";
import { listAllianceVideoProcessors } from "@/lib/video/processor-slots.server";
import {
  buildBusterDayReminderEmail,
  type BusterDayReminderKind,
} from "@/lib/vs-performance/buster-day-reminders.shared";

function resolveEmailFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    (process.env.NODE_ENV === "production"
      ? PRODUCTION_EMAIL_FROM
      : RESEND_DEV_EMAIL_FROM)
  );
}

async function listOwnerMaintainerEmails(
  allianceId: string,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.hqUsers,
      eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId),
    )
    .innerJoin(
      schema.roles,
      eq(schema.roles.id, schema.allianceMemberships.roleId),
    )
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        inArray(schema.roles.name, ["owner", "maintainer"]),
      ),
    );
  return rows
    .map((r) => r.email?.trim())
    .filter((email): email is string => Boolean(email));
}

/** Video processors ∪ owner/maintainer memberships (deduped). */
export async function listBusterDayReminderEmails(
  allianceId: string,
): Promise<string[]> {
  const [processors, admins] = await Promise.all([
    listAllianceVideoProcessors(allianceId),
    listOwnerMaintainerEmails(allianceId),
  ]);
  const emails = new Set<string>();
  for (const p of processors) {
    const email = p.email?.trim();
    if (email) emails.add(email.toLowerCase());
  }
  for (const email of admins) {
    emails.add(email.toLowerCase());
  }
  return [...emails];
}

export async function sendBusterDayReminderEmails(input: {
  allianceId: string;
  allianceTag: string;
  kind: BusterDayReminderKind;
  wizardUrl: string;
}): Promise<{ sent: number }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: 0 };

  const recipients = await listBusterDayReminderEmails(input.allianceId);
  if (recipients.length === 0) return { sent: 0 };

  const from = resolveEmailFromAddress();
  const { subject, html, text } = buildBusterDayReminderEmail({
    kind: input.kind,
    allianceTag: input.allianceTag,
    wizardUrl: input.wizardUrl,
  });

  let sent = 0;
  for (const to of recipients) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, html, text }),
      });
      if (res.ok) sent += 1;
    } catch {
      // Best-effort; cron retries while sentAt is still null.
    }
  }
  return { sent };
}
