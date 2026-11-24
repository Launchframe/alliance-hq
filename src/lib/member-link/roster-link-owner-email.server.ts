import "server-only";

import { eq } from "drizzle-orm";

import type { AppLocale } from "@/i18n/routing";
import { resolveAppOrigin } from "@/lib/app-origin";
import { getDb, schema } from "@/lib/db";
import {
  notificationTranslator,
  resolveRecipientLocale,
} from "@/lib/notifications/locale.server";
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

function rosterLinkTranslator(locale: AppLocale) {
  return notificationTranslator(locale, "notificationMessages.rosterLink");
}

function actionUrl(token: string): string {
  return `${resolveAppOrigin()}/api/roster-link-requests/action?token=${encodeURIComponent(token)}`;
}

function resolveRequestUrl(requestId: string): string {
  return `${resolveAppOrigin()}/members/roster-link-requests?request=${encodeURIComponent(requestId)}`;
}

export function buildRosterLinkOwnerEmail(
  input: {
    allianceTag: string;
    gameUserName: string;
    reportedName: string;
    gameUid: string;
    gameServerNumber: number | null;
    requestId: string;
    rejectToken: string;
    /** Reminder emails rotate tokens; prior Approve/Decline links stop working. */
    isReminder?: boolean;
  },
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = rosterLinkTranslator(locale);
  const acceptHref = resolveRequestUrl(input.requestId);
  const rejectHref = actionUrl(input.rejectToken);
  const subject = t("owner.subject", {
    name: input.gameUserName,
    tag: input.allianceTag,
  });
  const serverLine =
    input.gameServerNumber != null
      ? t("owner.server", { number: String(input.gameServerNumber) })
      : t("owner.serverUnknown");
  const intro = t("owner.intro", {
    tag: input.allianceTag,
    name: input.gameUserName,
    server: serverLine,
    reportedName: input.reportedName,
  });
  const reviewNote = t("owner.reviewNote");
  const linkRotationNote = input.isReminder
    ? t("owner.reminderNote")
    : t("owner.rotationNote");
  const reviewLabel = t("owner.review");
  const declineLabel = t("owner.decline");
  const unrecognized = t("owner.unrecognized");

  const text = `${intro}

${reviewNote}

${reviewLabel}: ${acceptHref}

${declineLabel}: ${rejectHref}

${unrecognized}

${linkRotationNote}`;

  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px 24px 8px;font-size:20px;font-weight:600;">${escapeHtml(t("owner.heading"))}</td></tr>
    <tr><td style="padding:0 24px 16px;line-height:1.5;">${escapeHtml(intro)}</td></tr>
    <tr><td style="padding:0 24px 12px;font-size:13px;color:#57606a;line-height:1.5;">${escapeHtml(reviewNote)}</td></tr>
    <tr><td style="padding:0 24px 12px;">
      <a href="${acceptHref}" style="display:inline-block;background:#238636;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;margin-right:8px;">${escapeHtml(reviewLabel)}</a>
      <a href="${rejectHref}" style="display:inline-block;background:#f6f8fa;color:#24292f;text-decoration:none;padding:10px 18px;border-radius:8px;border:1px solid #d0d7de;">${escapeHtml(declineLabel)}</a>
    </td></tr>
    <tr><td style="padding:0 24px 12px;font-size:13px;color:#57606a;">${escapeHtml(unrecognized)}</td></tr>
    <tr><td style="padding:0 24px 24px;font-size:13px;color:#57606a;">${escapeHtml(linkRotationNote)}</td></tr>
  </table>
</body>`;

  return { subject, html, text };
}

export function buildRosterLinkInviteeAcceptedEmail(
  input: {
    allianceTag: string;
    onboardUrl: string;
  },
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = rosterLinkTranslator(locale);
  const tag = input.allianceTag;
  const subject = t("accepted.subject", { tag });
  const text = t("accepted.text", { tag, url: input.onboardUrl });
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">${escapeHtml(t("accepted.heading"))}</td></tr>
    <tr><td style="padding:0 24px 16px;line-height:1.5;">${t("accepted.body", { tag: `<strong>${escapeHtml(tag)}</strong>` })}</td></tr>
    <tr><td style="padding:0 24px 24px;"><a href="${input.onboardUrl}" style="display:inline-block;background:#238636;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">${escapeHtml(t("accepted.continue"))}</a></td></tr>
  </table>
</body>`;
  return { subject, html, text };
}

export function buildRosterLinkInviteeRejectedEmail(
  input: {
    allianceTag: string;
  },
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = rosterLinkTranslator(locale);
  const tag = input.allianceTag;
  const subject = t("rejected.subject", { tag });
  const text = t("rejected.body", { tag });
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">${escapeHtml(t("rejected.heading"))}</td></tr>
    <tr><td style="padding:0 24px 24px;line-height:1.5;">${t("rejected.body", { tag: `<strong>${escapeHtml(tag)}</strong>` })}</td></tr>
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
  return (await resolveAllianceOwnerRecipient(allianceId))?.email ?? null;
}

/** Owner email plus the locale the owner reads notifications in. */
export async function resolveAllianceOwnerRecipient(
  allianceId: string,
): Promise<{ email: string; locale: AppLocale } | null> {
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

  const email = row?.ownerEmail?.trim() || row?.ownerUserEmail?.trim();
  if (!email) return null;
  return {
    email,
    locale: await resolveRecipientLocale({
      hqUserId: row?.ownerHqUserId,
      email,
    }),
  };
}

export async function sendRosterLinkOwnerApprovalEmail(input: {
  allianceId: string;
  allianceTag: string;
  requestId: string;
  gameUserName: string;
  reportedName: string;
  gameUid: string;
  gameServerNumber: number | null;
  acceptToken: string;
  rejectToken: string;
  isReminder?: boolean;
}): Promise<void> {
  const owner = await resolveAllianceOwnerRecipient(input.allianceId);
  if (!owner) {
    console.warn(
      "[alliance-hq] No owner email for alliance — roster link owner email skipped:",
      input.allianceId,
    );
    return;
  }

  const payload = buildRosterLinkOwnerEmail(input, owner.locale);
  await sendResendEmail({ to: owner.email, ...payload });
}

export async function sendRosterLinkInviteeResolvedEmail(input: {
  to: string;
  hqUserId?: string | null;
  allianceTag: string;
  accepted: boolean;
  onboardPath?: string;
}): Promise<void> {
  const onboardUrl = `${resolveAppOrigin()}${input.onboardPath ?? "/onboard"}`;
  const locale = await resolveRecipientLocale({
    hqUserId: input.hqUserId,
    email: input.to,
  });
  const payload = input.accepted
    ? buildRosterLinkInviteeAcceptedEmail(
        { allianceTag: input.allianceTag, onboardUrl },
        locale,
      )
    : buildRosterLinkInviteeRejectedEmail(
        { allianceTag: input.allianceTag },
        locale,
      );
  await sendResendEmail({ to: input.to, ...payload });
}
