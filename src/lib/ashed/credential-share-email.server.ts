import "server-only";

import { eq } from "drizzle-orm";

import { resolveAppOrigin } from "@/lib/app-origin";
import { getDb, schema } from "@/lib/db";
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

async function loadUserEmail(hqUserId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ email: schema.hqUsers.email })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);
  return row?.email?.trim() || null;
}

async function loadAllianceTag(allianceId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ tag: schema.alliances.tag })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row?.tag?.trim() || "your alliance";
}

export function buildCredentialShareInviteEmail(input: {
  allianceTag: string;
  ownerLabel: string;
  inviteUrl: string;
  capabilities: string[];
  expiresAt: string;
}): { subject: string; html: string; text: string } {
  const subject = `Credential access invite (${input.allianceTag})`;
  const text = `${input.ownerLabel} invited you to use their Ashed credentials in ${input.allianceTag}.

Capabilities: ${formatCapabilityList(input.capabilities)}
Access expires: ${input.expiresAt}

Accept in Alliance HQ: ${input.inviteUrl}

If you were not expecting this invite, you can ignore this email.`;
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:20px;font-weight:600;">Credential access invite</td></tr>
    <tr><td style="padding:0 24px 16px;line-height:1.5;"><strong>${escapeHtml(input.ownerLabel)}</strong> invited you to use their Ashed credentials in <strong>${escapeHtml(input.allianceTag)}</strong>.</td></tr>
    <tr><td style="padding:0 24px 8px;font-size:14px;">Capabilities: ${escapeHtml(formatCapabilityList(input.capabilities))}</td></tr>
    <tr><td style="padding:0 24px 16px;font-size:14px;">Access expires: ${escapeHtml(input.expiresAt)}</td></tr>
    <tr><td style="padding:0 24px 24px;"><a href="${input.inviteUrl}" style="display:inline-block;background:#238636;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Review invite</a></td></tr>
  </table>
</body>`;
  return { subject, html, text };
}

export function buildCredentialShareAcceptedEmail(input: {
  allianceTag: string;
  delegateLabel: string;
}): { subject: string; html: string; text: string } {
  const subject = `Credential access accepted (${input.allianceTag})`;
  const text = `${input.delegateLabel} accepted your credential share in ${input.allianceTag}. You can revoke access any time from Team settings: ${teamSettingsUrl()}`;
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">Credential access accepted</td></tr>
    <tr><td style="padding:0 24px 24px;line-height:1.5;"><strong>${escapeHtml(input.delegateLabel)}</strong> accepted your credential share in <strong>${escapeHtml(input.allianceTag)}</strong>.</td></tr>
  </table>
</body>`;
  return { subject, html, text };
}

export function buildCredentialShareRejectedEmail(input: {
  allianceTag: string;
  delegateLabel: string;
}): { subject: string; html: string; text: string } {
  const subject = `Credential access declined (${input.allianceTag})`;
  const text = `${input.delegateLabel} declined your credential share invite in ${input.allianceTag}.`;
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">Credential access declined</td></tr>
    <tr><td style="padding:0 24px 24px;line-height:1.5;"><strong>${escapeHtml(input.delegateLabel)}</strong> declined your credential share invite in <strong>${escapeHtml(input.allianceTag)}</strong>.</td></tr>
  </table>
</body>`;
  return { subject, html, text };
}

export function buildCredentialShareRevokedEmail(input: {
  allianceTag: string;
  ownerLabel: string;
}): { subject: string; html: string; text: string } {
  const subject = `Credential access revoked (${input.allianceTag})`;
  const text = `${input.ownerLabel} revoked your delegated Ashed credential access in ${input.allianceTag}.`;
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">Credential access revoked</td></tr>
    <tr><td style="padding:0 24px 24px;line-height:1.5;"><strong>${escapeHtml(input.ownerLabel)}</strong> revoked your delegated Ashed credential access in <strong>${escapeHtml(input.allianceTag)}</strong>.</td></tr>
  </table>
</body>`;
  return { subject, html, text };
}

export function buildCredentialShareExpiredEmail(input: {
  allianceTag: string;
  endReason: AshedCredentialShareEndReason;
  recipientRole: "owner" | "delegate";
}): { subject: string; html: string; text: string } {
  const reasonLabel =
    input.endReason === "owner_token_expired"
      ? "the owner's Ashed token expired"
      : input.endReason === "membership_ended"
        ? "an officer left the alliance"
        : "the access period ended";
  const subject = `Credential access ended (${input.allianceTag})`;
  const body =
    input.recipientRole === "owner"
      ? `Delegated credential access in ${input.allianceTag} ended because ${reasonLabel}.`
      : `Your delegated credential access in ${input.allianceTag} ended because ${reasonLabel}.`;
  const text = `${body}\n\nView history: ${accountSharesUrl()}`;
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">Credential access ended</td></tr>
    <tr><td style="padding:0 24px 24px;line-height:1.5;">${escapeHtml(body)}</td></tr>
  </table>
</body>`;
  return { subject, html, text };
}

export function buildCredentialShareOwnerDigestEmail(input: {
  allianceTag: string;
  activityCount: number;
  dayLabel: string;
}): { subject: string; html: string; text: string } {
  const subject = `Credential share activity — ${input.dayLabel} (${input.allianceTag})`;
  const text = `Yesterday there were ${input.activityCount} credential share events attributed to your account in ${input.allianceTag}. Review history: ${accountSharesUrl()}`;
  const html = `
<body style="background:#f6f8fa;font-family:Helvetica,Arial,sans-serif;color:#24292f;">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #d0d7de;border-radius:12px;">
    <tr><td style="padding:24px;font-size:18px;font-weight:600;">Daily credential share digest</td></tr>
    <tr><td style="padding:0 24px 24px;line-height:1.5;">Yesterday there were <strong>${input.activityCount}</strong> credential share events attributed to your account in <strong>${escapeHtml(input.allianceTag)}</strong>.</td></tr>
    <tr><td style="padding:0 24px 24px;"><a href="${accountSharesUrl()}" style="display:inline-block;background:#238636;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">View history</a></td></tr>
  </table>
</body>`;
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
  const [inviteeEmail, ownerEmail, allianceTag] = await Promise.all([
    loadUserEmail(input.invitedHqUserId),
    loadUserEmail(input.ownerHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!inviteeEmail) return;

  const ownerLabel = ownerEmail ?? "An alliance officer";
  const payload = buildCredentialShareInviteEmail({
    allianceTag,
    ownerLabel,
    inviteUrl: input.inviteUrl,
    capabilities: input.capabilities,
    expiresAt: input.expiresAt.toISOString(),
  });
  await sendResendEmail({ to: inviteeEmail, ...payload });
}

export async function sendCredentialShareAcceptedEmail(input: {
  ownerHqUserId: string;
  delegateHqUserId: string;
  allianceId: string;
}): Promise<void> {
  const [ownerEmail, delegateEmail, allianceTag] = await Promise.all([
    loadUserEmail(input.ownerHqUserId),
    loadUserEmail(input.delegateHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!ownerEmail) return;

  const delegateLabel = delegateEmail ?? "An officer";
  const payload = buildCredentialShareAcceptedEmail({
    allianceTag,
    delegateLabel,
  });
  await sendResendEmail({ to: ownerEmail, ...payload });
}

export async function sendCredentialShareRejectedEmail(input: {
  ownerHqUserId: string;
  invitedHqUserId: string;
  allianceId: string;
}): Promise<void> {
  const [ownerEmail, inviteeEmail, allianceTag] = await Promise.all([
    loadUserEmail(input.ownerHqUserId),
    loadUserEmail(input.invitedHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!ownerEmail) return;

  const delegateLabel = inviteeEmail ?? "An officer";
  const payload = buildCredentialShareRejectedEmail({
    allianceTag,
    delegateLabel,
  });
  await sendResendEmail({ to: ownerEmail, ...payload });
}

export async function sendCredentialShareRevokedEmail(input: {
  ownerHqUserId: string;
  delegateHqUserId: string | null;
  invitedHqUserId: string;
  allianceId: string;
}): Promise<void> {
  const recipientId = input.delegateHqUserId ?? input.invitedHqUserId;
  const [recipientEmail, ownerEmail, allianceTag] = await Promise.all([
    loadUserEmail(recipientId),
    loadUserEmail(input.ownerHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!recipientEmail || !ownerEmail) return;

  const payload = buildCredentialShareRevokedEmail({
    allianceTag,
    ownerLabel: ownerEmail,
  });
  await sendResendEmail({ to: recipientEmail, ...payload });
}

export async function sendCredentialShareExpiredEmails(input: {
  ownerHqUserId: string;
  delegateHqUserId: string | null;
  allianceId: string;
  endReason: AshedCredentialShareEndReason;
}): Promise<void> {
  const [ownerEmail, delegateEmail, allianceTag] = await Promise.all([
    loadUserEmail(input.ownerHqUserId),
    input.delegateHqUserId
      ? loadUserEmail(input.delegateHqUserId)
      : Promise.resolve(null),
    loadAllianceTag(input.allianceId),
  ]);

  if (ownerEmail) {
    const ownerPayload = buildCredentialShareExpiredEmail({
      allianceTag,
      endReason: input.endReason,
      recipientRole: "owner",
    });
    await sendResendEmail({ to: ownerEmail, ...ownerPayload });
  }

  if (delegateEmail) {
    const delegatePayload = buildCredentialShareExpiredEmail({
      allianceTag,
      endReason: input.endReason,
      recipientRole: "delegate",
    });
    await sendResendEmail({ to: delegateEmail, ...delegatePayload });
  }
}

export async function sendCredentialShareOwnerDigestEmail(input: {
  ownerHqUserId: string;
  allianceId: string;
  activityCount: number;
  dayLabel: string;
}): Promise<void> {
  const [ownerEmail, allianceTag] = await Promise.all([
    loadUserEmail(input.ownerHqUserId),
    loadAllianceTag(input.allianceId),
  ]);
  if (!ownerEmail || input.activityCount <= 0) return;

  const payload = buildCredentialShareOwnerDigestEmail({
    allianceTag,
    activityCount: input.activityCount,
    dayLabel: input.dayLabel,
  });
  await sendResendEmail({ to: ownerEmail, ...payload });
}
