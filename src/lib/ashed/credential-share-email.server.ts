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

import type { AshedCredentialShareEndReason } from "@/lib/db/schema";

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

function formatCapabilityList(capabilities: string[]): string {
  return capabilities.join(", ");
}


function accountSharesUrl(): string {
  return `${resolveAppOrigin()}/account/credential-shares`;
}

function teamSettingsUrl(): string {
  return `${resolveAppOrigin()}/settings/team`;
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
      "[alliance-hq] RESEND_API_KEY missing — credential share email not sent:",
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
      `Resend credential share email failed: ${JSON.stringify(await res.json())}`,
    );
  }
}

type Recipient = { email: string | null; locale: AppLocale };

async function loadRecipient(hqUserId: string): Promise<Recipient> {
  const db = getDb();
  const [row] = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  const email = row?.email?.trim() || null;
  return {
    email,
    locale: email ? await resolveRecipientLocale({ hqUserId }) : "en-US",
  };
}

async function loadAllianceTag(allianceId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ tag: schema.alliances.tag })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row?.tag?.trim() || null;
}

function shareTranslator(locale: AppLocale) {
  return notificationTranslator(locale, "notificationMessages.credentialShare");
}

function strong(value: string): string {
  return `<strong>${escapeHtml(value)}</strong>`;
}

function layout(heading: string, rows: string): string {
  return `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">${escapeHtml(heading)}</td></tr>
${rows}
  </table>
</body>`;
}

function button(href: string, label: string): string {
  return `    <tr><td style="padding:0 24px 24px;"><a href="${href}" style="display:inline-block;background:#238636;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">${escapeHtml(label)}</a></td></tr>`;
}

export function buildCredentialShareInviteEmail(
  input: {
    allianceTag: string;
    ownerLabel: string;
    inviteUrl: string;
    capabilities: string[];
    expiresAt: string;
  },
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = shareTranslator(locale);
  const tag = input.allianceTag;
  const capabilities = formatCapabilityList(input.capabilities);
  const subject = t("invite.subject", { tag });
  const text = `${t("invite.body", { owner: input.ownerLabel, tag })}

${t("invite.capabilities", { capabilities })}
${t("invite.expires", { expiresAt: input.expiresAt })}

${t("invite.acceptText", { url: input.inviteUrl })}

${t("invite.ignore")}`;
  const html = layout(
    t("invite.heading"),
    `    <tr><td style="padding:0 24px 16px;line-height:1.5;">${t("invite.body", { owner: strong(input.ownerLabel), tag: strong(tag) })}</td></tr>
    <tr><td style="padding:0 24px 8px;font-size:14px;">${escapeHtml(t("invite.capabilities", { capabilities }))}</td></tr>
    <tr><td style="padding:0 24px 16px;font-size:14px;">${escapeHtml(t("invite.expires", { expiresAt: input.expiresAt }))}</td></tr>
${button(input.inviteUrl, t("invite.review"))}`,
  );
  return { subject, html, text };
}

export function buildCredentialShareAcceptedEmail(
  input: {
    allianceTag: string;
    delegateLabel: string;
  },
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = shareTranslator(locale);
  const tag = input.allianceTag;
  const subject = t("accepted.subject", { tag });
  const text = t("accepted.text", {
    delegate: input.delegateLabel,
    tag,
    url: teamSettingsUrl(),
  });
  const html = layout(
    t("accepted.heading"),
    `    <tr><td style="padding:0 24px 24px;line-height:1.5;">${t("accepted.body", { delegate: strong(input.delegateLabel), tag: strong(tag) })}</td></tr>`,
  );
  return { subject, html, text };
}

export function buildCredentialShareRejectedEmail(
  input: {
    allianceTag: string;
    delegateLabel: string;
  },
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = shareTranslator(locale);
  const tag = input.allianceTag;
  const subject = t("rejected.subject", { tag });
  const text = t("rejected.body", { delegate: input.delegateLabel, tag });
  const html = layout(
    t("rejected.heading"),
    `    <tr><td style="padding:0 24px 24px;line-height:1.5;">${t("rejected.body", { delegate: strong(input.delegateLabel), tag: strong(tag) })}</td></tr>`,
  );
  return { subject, html, text };
}

export function buildCredentialShareRevokedEmail(
  input: {
    allianceTag: string;
    ownerLabel: string;
  },
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = shareTranslator(locale);
  const tag = input.allianceTag;
  const subject = t("revoked.subject", { tag });
  const text = t("revoked.body", { owner: input.ownerLabel, tag });
  const html = layout(
    t("revoked.heading"),
    `    <tr><td style="padding:0 24px 24px;line-height:1.5;">${t("revoked.body", { owner: strong(input.ownerLabel), tag: strong(tag) })}</td></tr>`,
  );
  return { subject, html, text };
}

const END_REASON_KEYS: Record<string, string> = {
  owner_token_expired: "ownerTokenExpired",
  membership_ended: "membershipEnded",
};

export function buildCredentialShareExpiredEmail(
  input: {
    allianceTag: string;
    endReason: AshedCredentialShareEndReason;
    recipientRole: "owner" | "delegate";
  },
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = shareTranslator(locale);
  const tag = input.allianceTag;
  const reason = t(`ended.reason.${END_REASON_KEYS[input.endReason] ?? "periodEnded"}`);
  const subject = t("ended.subject", { tag });
  const body =
    input.recipientRole === "owner"
      ? t("ended.ownerBody", { tag, reason })
      : t("ended.delegateBody", { tag, reason });
  const text = `${body}\n\n${t("ended.historyText", { url: accountSharesUrl() })}`;
  const html = layout(
    t("ended.heading"),
    `    <tr><td style="padding:0 24px 24px;line-height:1.5;">${escapeHtml(body)}</td></tr>`,
  );
  return { subject, html, text };
}

export function buildCredentialShareOwnerDigestEmail(
  input: {
    allianceTag: string;
    activityCount: number;
    dayLabel: string;
  },
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = shareTranslator(locale);
  const tag = input.allianceTag;
  const subject = t("digest.subject", { day: input.dayLabel, tag });
  const text = t("digest.text", {
    count: input.activityCount,
    tag,
    url: accountSharesUrl(),
  });
  const html = layout(
    t("digest.heading"),
    `    <tr><td style="padding:0 24px 24px;line-height:1.5;">${t("digest.body", { count: `<strong>${input.activityCount}</strong>`, tag: strong(tag) })}</td></tr>
${button(accountSharesUrl(), t("digest.viewHistory"))}`,
  );
  return { subject, html, text };
}

export async function sendCredentialShareInviteEmail(input: {
  invitedHqUserId: string;
  ownerHqUserId: string;
  allianceId: string;
  inviteUrl: string;
  capabilities: string[];
  expiresAt: Date;
}): Promise<void> {
  const [invitee, owner, allianceTag] = await Promise.all([
    loadRecipient(input.invitedHqUserId),
    loadRecipient(input.ownerHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!invitee.email) return;

  const t = shareTranslator(invitee.locale);
  const payload = buildCredentialShareInviteEmail(
    {
      allianceTag: allianceTag ?? t("fallbackAlliance"),
      ownerLabel: owner.email ?? t("fallbackOwner"),
      inviteUrl: input.inviteUrl,
      capabilities: input.capabilities,
      expiresAt: input.expiresAt.toISOString(),
    },
    invitee.locale,
  );
  await sendResendEmail({ to: invitee.email, ...payload });
}

export async function sendCredentialShareAcceptedEmail(input: {
  ownerHqUserId: string;
  delegateHqUserId: string;
  allianceId: string;
}): Promise<void> {
  const [owner, delegate, allianceTag] = await Promise.all([
    loadRecipient(input.ownerHqUserId),
    loadRecipient(input.delegateHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!owner.email) return;

  const t = shareTranslator(owner.locale);
  const payload = buildCredentialShareAcceptedEmail(
    {
      allianceTag: allianceTag ?? t("fallbackAlliance"),
      delegateLabel: delegate.email ?? t("fallbackDelegate"),
    },
    owner.locale,
  );
  await sendResendEmail({ to: owner.email, ...payload });
}

export async function sendCredentialShareRejectedEmail(input: {
  ownerHqUserId: string;
  invitedHqUserId: string;
  allianceId: string;
}): Promise<void> {
  const [owner, invitee, allianceTag] = await Promise.all([
    loadRecipient(input.ownerHqUserId),
    loadRecipient(input.invitedHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!owner.email) return;

  const t = shareTranslator(owner.locale);
  const payload = buildCredentialShareRejectedEmail(
    {
      allianceTag: allianceTag ?? t("fallbackAlliance"),
      delegateLabel: invitee.email ?? t("fallbackDelegate"),
    },
    owner.locale,
  );
  await sendResendEmail({ to: owner.email, ...payload });
}

export async function sendCredentialShareRevokedEmail(input: {
  ownerHqUserId: string;
  delegateHqUserId: string | null;
  invitedHqUserId: string;
  allianceId: string;
}): Promise<void> {
  const recipientId = input.delegateHqUserId ?? input.invitedHqUserId;
  const [recipient, owner, allianceTag] = await Promise.all([
    loadRecipient(recipientId),
    loadRecipient(input.ownerHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!recipient.email || !owner.email) return;

  const t = shareTranslator(recipient.locale);
  const payload = buildCredentialShareRevokedEmail(
    {
      allianceTag: allianceTag ?? t("fallbackAlliance"),
      ownerLabel: owner.email,
    },
    recipient.locale,
  );
  await sendResendEmail({ to: recipient.email, ...payload });
}

export async function sendCredentialShareExpiredEmails(input: {
  ownerHqUserId: string;
  delegateHqUserId: string | null;
  allianceId: string;
  endReason: AshedCredentialShareEndReason;
}): Promise<void> {
  const [owner, delegate, allianceTag] = await Promise.all([
    loadRecipient(input.ownerHqUserId),
    input.delegateHqUserId
      ? loadRecipient(input.delegateHqUserId)
      : Promise.resolve<Recipient>({ email: null, locale: "en-US" }),
    loadAllianceTag(input.allianceId),
  ]);

  for (const [recipient, recipientRole] of [
    [owner, "owner"],
    [delegate, "delegate"],
  ] as const) {
    if (!recipient.email) continue;
    const payload = buildCredentialShareExpiredEmail(
      {
        allianceTag:
          allianceTag ?? shareTranslator(recipient.locale)("fallbackAlliance"),
        endReason: input.endReason,
        recipientRole,
      },
      recipient.locale,
    );
    await sendResendEmail({ to: recipient.email, ...payload });
  }
}

export async function sendCredentialShareOwnerDigestEmail(input: {
  ownerHqUserId: string;
  allianceId: string;
  activityCount: number;
  dayLabel: string;
}): Promise<void> {
  const [owner, allianceTag] = await Promise.all([
    loadRecipient(input.ownerHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!owner.email || input.activityCount <= 0) return;

  const payload = buildCredentialShareOwnerDigestEmail(
    {
      allianceTag:
        allianceTag ?? shareTranslator(owner.locale)("fallbackAlliance"),
      activityCount: input.activityCount,
      dayLabel: input.dayLabel,
    },
    owner.locale,
  );
  await sendResendEmail({ to: owner.email, ...payload });
}
