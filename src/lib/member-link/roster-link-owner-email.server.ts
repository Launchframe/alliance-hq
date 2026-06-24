import "server-only";

import { eq } from "drizzle-orm";

import { resolveAppOrigin } from "@/lib/app-origin";
import { getDb, schema } from "@/lib/db";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";

function resolveEmailFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    (process.env.NODE_ENV === "production"
      ? PRODUCTION_EMAIL_FROM
      : RESEND_DEV_EMAIL_FROM)
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function actionUrl(token: string): string {
  return `${resolveAppOrigin()}/api/roster-link-requests/action?token=${encodeURIComponent(token)}`;
}

export function buildRosterLinkOwnerEmail(input: {
  allianceTag: string;
  gameUserName: string;
  reportedName: string;
  gameUid: string;
  gameServerNumber: number;
  acceptToken: string;
  rejectToken: string;
  /** Reminder emails rotate tokens; prior Approve/Decline links stop working. */
  isReminder?: boolean;
}): { subject: string; html: string; text: string } {
  const acceptHref = actionUrl(input.acceptToken);
  const rejectHref = actionUrl(input.rejectToken);
  const subject = `Approve roster link for ${input.gameUserName} (${input.allianceTag})`;
  const intro = `A player accepted your HQ invite but is not on the ${input.allianceTag} roster yet. Last War shows their commander as ${input.gameUserName} (UID ending …${input.gameUid.slice(-4)}, server ${input.gameServerNumber}). They submitted the name "${input.reportedName}".`;
  const linkRotationNote = input.isReminder
    ? "This is a reminder — use only the Approve and Decline links in this email. Links from earlier messages about this request no longer work."
    : "If we send another email about this request, use only the newest Approve and Decline links — older links stop working when we resend.";

  const text = `${intro}

Approve: ${acceptHref}

Decline: ${rejectHref}

If you do not recognize this player, decline the request.

${linkRotationNote}`;

  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px 24px 8px;font-size:20px;font-weight:600;">Roster link approval</td></tr>
    <tr><td style="padding:0 24px 16px;line-height:1.5;">${escapeHtml(intro)}</td></tr>
    <tr><td style="padding:0 24px 12px;">
      <a href="${acceptHref}" style="display:inline-block;background:#238636;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;margin-right:8px;">Approve</a>
      <a href="${rejectHref}" style="display:inline-block;background:#f6f8fa;color:#24292f;text-decoration:none;padding:10px 18px;border-radius:8px;border:1px solid #d0d7de;">Decline</a>
    </td></tr>
    <tr><td style="padding:0 24px 12px;font-size:13px;color:#57606a;">If you do not recognize this player, decline the request.</td></tr>
    <tr><td style="padding:0 24px 24px;font-size:13px;color:#57606a;">${escapeHtml(linkRotationNote)}</td></tr>
  </table>
</body>`;

  return { subject, html, text };
}

export function buildRosterLinkInviteeAcceptedEmail(input: {
  allianceTag: string;
  onboardUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `You're approved — finish linking (${input.allianceTag})`;
  const text = `Your alliance owner approved your roster link for ${input.allianceTag}. Return to Alliance HQ to finish: ${input.onboardUrl}`;
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">You're approved</td></tr>
    <tr><td style="padding:0 24px 16px;line-height:1.5;">Your alliance owner approved your roster link for <strong>${escapeHtml(input.allianceTag)}</strong>. Return to Alliance HQ to finish linking your character.</td></tr>
    <tr><td style="padding:0 24px 24px;"><a href="${input.onboardUrl}" style="display:inline-block;background:#238636;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Continue in Alliance HQ</a></td></tr>
  </table>
</body>`;
  return { subject, html, text };
}

export function buildRosterLinkInviteeRejectedEmail(input: {
  allianceTag: string;
}): { subject: string; html: string; text: string } {
  const subject = `Roster link not approved (${input.allianceTag})`;
  const text = `Your alliance owner declined the roster link request for ${input.allianceTag}. If you think this was a mistake, contact your R5 directly.`;
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">Request declined</td></tr>
    <tr><td style="padding:0 24px 24px;line-height:1.5;">Your alliance owner declined the roster link request for <strong>${escapeHtml(input.allianceTag)}</strong>. If you think this was a mistake, contact your R5 directly.</td></tr>
  </table>
</body>`;
  return { subject, html, text };
}

async function sendResendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (process.env.E2E_TEST === "true") {
    return;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(
      "[alliance-hq] RESEND_API_KEY missing — roster link email not sent:",
      input.subject,
    );
    console.warn(input.text);
    return;
  }

  const from = resolveEmailFromAddress();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Resend roster link email failed: ${JSON.stringify(await res.json())}`,
    );
  }
}

export async function resolveAllianceOwnerEmail(
  allianceId: string,
): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({
      ownerEmail: schema.alliances.ownerEmail,
      ownerHqUserId: schema.alliances.ownerHqUserId,
      ownerUserEmail: schema.hqUsers.email,
    })
    .from(schema.alliances)
    .leftJoin(
      schema.hqUsers,
      eq(schema.alliances.ownerHqUserId, schema.hqUsers.id),
    )
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const direct = row?.ownerEmail?.trim();
  if (direct) return direct;
  const userEmail = row?.ownerUserEmail?.trim();
  return userEmail || null;
}

export async function sendRosterLinkOwnerApprovalEmail(input: {
  allianceId: string;
  allianceTag: string;
  gameUserName: string;
  reportedName: string;
  gameUid: string;
  gameServerNumber: number;
  acceptToken: string;
  rejectToken: string;
  isReminder?: boolean;
}): Promise<void> {
  const to = await resolveAllianceOwnerEmail(input.allianceId);
  if (!to) {
    console.warn(
      "[alliance-hq] No owner email for alliance — roster link owner email skipped:",
      input.allianceId,
    );
    return;
  }

  const payload = buildRosterLinkOwnerEmail(input);
  await sendResendEmail({ to, ...payload });
}

export async function sendRosterLinkInviteeResolvedEmail(input: {
  to: string;
  allianceTag: string;
  accepted: boolean;
  onboardPath?: string;
}): Promise<void> {
  const onboardUrl = `${resolveAppOrigin()}${input.onboardPath ?? "/onboard"}`;
  const payload = input.accepted
    ? buildRosterLinkInviteeAcceptedEmail({
        allianceTag: input.allianceTag,
        onboardUrl,
      })
    : buildRosterLinkInviteeRejectedEmail({ allianceTag: input.allianceTag });
  await sendResendEmail({ to: input.to, ...payload });
}
