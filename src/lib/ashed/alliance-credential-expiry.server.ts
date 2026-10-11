import "server-only";

import { and, eq, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createTranslator } from "next-intl";

import enUS from "../../../messages/en-US.json";
import idMessages from "../../../messages/id.json";
import ptBR from "../../../messages/pt-BR.json";

import type { AppLocale } from "@/i18n/routing";
import type { AllianceAccessRole } from "@/lib/alliance/types";
import { resolveAppOrigin } from "@/lib/app-origin";
import type { ParsedConnection } from "@/lib/connectionString";
import { decryptSecret, encryptSecret } from "@/lib/crypto/encrypt";
import { getDb, schema } from "@/lib/db";
import { loadUserLocaleStates } from "@/lib/i18n/user-locale.server";
import { decodeJwtPayload } from "@/lib/jwt/decode";
import { resolveTokenExpiresAt } from "@/lib/jwt/connection-meta";
import {
  claimOpsAlertFingerprint,
  emailPlatformMaintainers,
  releaseOpsAlertFingerprint,
} from "@/lib/ops/platform-maintainer-alert.server";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";
import type { AccountTimezoneId } from "@/lib/timezone/constants";
import { formatAccountDateTime } from "@/lib/timezone/format";
import { getAllianceAshedCredential } from "@/lib/vr/repository";

import {
  ALLIANCE_CREDENTIAL_REMINDER_DAYS,
  allianceCredentialExpiryStage,
  allianceCredentialNoticeDue,
  decideAllianceCredentialRefresh,
  jwtPayloadMatchesAshedUser,
  type AllianceCredentialBanner,
  type AllianceCredentialExpiryStage,
  type AllianceCredentialRefreshDecision,
} from "./alliance-credential-expiry.shared";

const OFFICER_PERMISSIONS = ["alliance:write", "ashed:connect"] as const;

/** HQ user has stored an Ashed session credential at least once. */
function hasConnectedAshedSql(hqUserIdColumn: unknown) {
  return sql`exists (
    select 1 from ${schema.sessions}
    join ${schema.ashedCredentials} on ${schema.ashedCredentials.sessionId} = ${schema.sessions.id}
    where ${schema.sessions.hqUserId} = ${hqUserIdColumn}
  )`;
}

/** Officers who can act on an alliance Ashed token: officer permissions + connected Ashed before. */
export async function listAllianceCredentialOfficers(
  allianceId: string,
): Promise<Array<{ email: string; hqUserId: string }>> {
  const rows = await getDb()
    .selectDistinct({ email: schema.hqUsers.email, hqUserId: schema.hqUsers.id })
    .from(schema.allianceMemberships)
    .innerJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.allianceMemberships.hqUserId))
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.status, "active"),
        ...OFFICER_PERMISSIONS.map(
          (permission) => sql`exists (
            select 1 from ${schema.rolePermissions}
            where ${schema.rolePermissions.roleId} = ${schema.allianceMemberships.roleId}
              and ${schema.rolePermissions.permissionId} = ${permission}
          )`,
        ),
        hasConnectedAshedSql(schema.hqUsers.id),
      ),
    );
  return rows
    .map((row) => ({ email: row.email.trim(), hqUserId: row.hqUserId }))
    .filter((row) => row.email);
}

async function hqUserHasConnectedAshed(hqUserId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.ashedCredentials.id })
    .from(schema.ashedCredentials)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.ashedCredentials.sessionId))
    .where(eq(schema.sessions.hqUserId, hqUserId))
    .limit(1);
  return Boolean(row);
}

/** Shell banner for officers who have connected Ashed and can refresh the alliance token. */
export async function loadAllianceCredentialBanner(input: {
  allianceId: string | null;
  hqUserId: string | null;
  permissions: readonly string[];
  locale: string;
  timezoneId?: AccountTimezoneId;
  now?: Date;
}): Promise<AllianceCredentialBanner | null> {
  if (!input.allianceId || !input.hqUserId) return null;
  const isMaintainer = input.permissions.includes("hq:admin");
  if (!isMaintainer && !OFFICER_PERMISSIONS.every((p) => input.permissions.includes(p))) {
    return null;
  }

  const [row] = await getDb()
    .select({
      tag: schema.alliances.tag,
      operatingMode: schema.alliances.operatingMode,
      tokenExpiresAt: schema.allianceAshedCredentials.tokenExpiresAt,
    })
    .from(schema.allianceAshedCredentials)
    .innerJoin(schema.alliances, eq(schema.alliances.id, schema.allianceAshedCredentials.allianceId))
    .where(eq(schema.allianceAshedCredentials.allianceId, input.allianceId))
    .limit(1);
  if (!row || row.operatingMode === "native" || !row.tokenExpiresAt) return null;

  const stage = allianceCredentialExpiryStage(row.tokenExpiresAt, input.now);
  if (!stage) return null;
  if (!(await hqUserHasConnectedAshed(input.hqUserId))) return null;

  return {
    allianceTag: row.tag?.trim() || "",
    expired: stage === "expired",
    expiresAtFormatted: formatAccountDateTime(row.tokenExpiresAt, {
      locale: input.locale,
      timezoneId: input.timezoneId,
      dateStyle: "long",
    }),
  };
}

/**
 * After an officer reconnects Ashed, copy their fresh token onto the alliance
 * bot credential when it outlives the stored one and they may own that slot.
 * Best-effort: callers must not fail the connect flow on errors.
 */
export async function maybeRefreshAllianceAshedCredentialFromConnection(input: {
  allianceId: string;
  ashedAllianceId: string;
  accessRole: AllianceAccessRole;
  connection: ParsedConnection;
  ashedUser: { id?: string | null; email?: string | null };
  hqUserId: string | null;
  sessionId?: string;
}): Promise<AllianceCredentialRefreshDecision> {
  const db = getDb();
  const [alliance] = await db
    .select({
      ashedAllianceId: schema.alliances.ashedAllianceId,
      operatingMode: schema.alliances.operatingMode,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, input.allianceId))
    .limit(1);
  if (
    !alliance ||
    alliance.operatingMode === "native" ||
    alliance.ashedAllianceId?.trim() !== input.ashedAllianceId
  ) {
    return { refresh: false, reason: "not_authorized" };
  }

  const credential = await getAllianceAshedCredential(input.allianceId);
  let isSameAshedIdentity = false;
  if (credential) {
    try {
      isSameAshedIdentity = jwtPayloadMatchesAshedUser(
        decodeJwtPayload(decryptSecret(credential.encryptedToken)),
        input.ashedUser,
      );
    } catch {
      isSameAshedIdentity = false;
    }
  }

  const newExpiresAt = resolveTokenExpiresAt(input.connection.token);
  const decision = decideAllianceCredentialRefresh({
    hasAllianceCredential: Boolean(credential),
    storedExpiresAt: credential?.tokenExpiresAt ?? null,
    newExpiresAt,
    isAshedOwner: input.accessRole === "owner",
    isSameRegistrant: Boolean(
      input.hqUserId && credential?.registeredByHqUserId === input.hqUserId,
    ),
    isSameAshedIdentity,
  });
  if (!decision.refresh) return decision;

  // Conditional on expiry so a concurrent refresh with a shorter-lived token
  // cannot overwrite a newer one (expiry only moves forward).
  const won = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.allianceAshedCredentials)
      .set({
        appId: input.connection.appId,
        originUrl: input.connection.originUrl,
        encryptedToken: encryptSecret(input.connection.token),
        tokenExpiresAt: newExpiresAt,
        expiryNoticeStage: null,
        expiryNoticeSentAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.allianceAshedCredentials.allianceId, input.allianceId),
          or(
            isNull(schema.allianceAshedCredentials.tokenExpiresAt),
            lt(schema.allianceAshedCredentials.tokenExpiresAt, newExpiresAt!),
          ),
        ),
      )
      .returning({ id: schema.allianceAshedCredentials.id });
    if (!updated) return false;
    await tx.insert(schema.auditLog).values({
      id: nanoid(),
      sessionId: input.sessionId ?? null,
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      action: "alliance_ashed_credential.auto_refresh",
      resourceType: "alliance_ashed_credential",
      resourceId: updated.id,
      metadata: {
        previousExpiresAt: credential?.tokenExpiresAt?.toISOString() ?? null,
        newExpiresAt: newExpiresAt?.toISOString() ?? null,
      },
      severity: "routine",
    });
    return true;
  });
  return won ? decision : { refresh: false, reason: "not_longer_lived" };
}

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

async function sendOfficerEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (process.env.E2E_TEST === "true") return;
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[alliance-hq] RESEND_API_KEY missing — alliance token notice not sent:", input.subject);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: resolveEmailFromAddress(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend alliance token notice failed: ${res.status}`);
  }
}

export type AllianceCredentialNoticeContext = {
  allianceId: string;
  allianceTag: string;
  allianceName: string | null;
  stage: AllianceCredentialExpiryStage;
  expiresAt: Date;
  officerCount: number;
};

function formatUtcDate(date: Date, locale: AppLocale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
}

const OFFICER_EMAIL_MESSAGES: Record<AppLocale, typeof enUS.allianceCredentialEmail> = {
  "en-US": enUS.allianceCredentialEmail,
  "pt-BR": ptBR.allianceCredentialEmail,
  id: idMessages.allianceCredentialEmail,
};

const URL_SLOT = "__HQ_EMAIL_URL__";

function linkifiedStepHtml(step: string, url: string): string {
  const [before = "", after = ""] = step.split(URL_SLOT);
  return `${escapeHtml(before)}<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>${escapeHtml(after)}`;
}

export function buildOfficerAllianceCredentialEmail(
  ctx: AllianceCredentialNoticeContext,
  locale: AppLocale = "en-US",
): { subject: string; text: string; html: string } {
  const t = createTranslator({
    locale,
    messages: { email: OFFICER_EMAIL_MESSAGES[locale] ?? OFFICER_EMAIL_MESSAGES["en-US"] },
    namespace: "email",
  });
  const date = formatUtcDate(ctx.expiresAt, locale);
  const tag = ctx.allianceTag;
  const connectUrl = `${resolveAppOrigin()}/connect`;
  const teamUrl = `${resolveAppOrigin()}/settings/team`;
  const expired = ctx.stage === "expired";
  const subject = expired ? t("subjectExpired", { tag }) : t("subjectUpcoming", { tag, date });
  const lead = expired ? t("leadExpired", { tag, date }) : t("leadUpcoming", { tag, date });
  const heading = t("stepsHeading");
  const signature = t("signature");
  const steps = [
    { url: connectUrl, template: t("stepReconnect", { url: URL_SLOT }) },
    { url: teamUrl, template: t("stepOwner", { url: URL_SLOT }) },
  ];
  const text = `${lead}\n\n${heading}\n- ${steps
    .map((step) => step.template.split(URL_SLOT).join(step.url))
    .join("\n- ")}\n\n${signature}`;
  const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
<p>${escapeHtml(lead)}</p>
<p style="margin:16px 0 8px;font-weight:600;">${escapeHtml(heading)}</p>
<ul>
${steps.map((step) => `<li>${linkifiedStepHtml(step.template, step.url)}</li>`).join("\n")}
</ul>
<p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">${escapeHtml(signature)}</p>
</div>`;
  return { subject, text, html };
}

export function buildMaintainerAllianceCredentialEmail(
  ctx: AllianceCredentialNoticeContext,
): { subject: string; text: string; html: string } {
  const date = formatUtcDate(ctx.expiresAt);
  const label = ctx.allianceName ? `${ctx.allianceTag} (${ctx.allianceName})` : ctx.allianceTag;
  const verb = ctx.stage === "expired" ? "expired on" : "expires on";
  const subject = `[Alliance HQ] ${ctx.allianceTag} alliance Ashed token ${verb} ${date}`;
  const lines = [
    `Alliance: ${label}`,
    `HQ alliance id: ${ctx.allianceId}`,
    `Token ${verb}: ${ctx.expiresAt.toISOString()}`,
    `Officers notified: ${ctx.officerCount}`,
    `Impact: VS score sync, Ashed roster sync, and Ashed score checks fail closed while expired.`,
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;"><ul>${lines
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("")}</ul></div>`;
  return { subject, text, html };
}

/** Daily pass: one `upcoming` and one `expired` notice per alliance token. */
export async function runAllianceCredentialExpiryNoticePass(now = new Date()): Promise<{
  checked: number;
  notified: number;
}> {
  const db = getDb();
  const horizon = new Date(now.getTime() + ALLIANCE_CREDENTIAL_REMINDER_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      allianceId: schema.allianceAshedCredentials.allianceId,
      tokenExpiresAt: schema.allianceAshedCredentials.tokenExpiresAt,
      sentStage: schema.allianceAshedCredentials.expiryNoticeStage,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
    })
    .from(schema.allianceAshedCredentials)
    .innerJoin(schema.alliances, eq(schema.alliances.id, schema.allianceAshedCredentials.allianceId))
    .where(
      and(
        ne(schema.alliances.operatingMode, "native"),
        isNotNull(schema.allianceAshedCredentials.tokenExpiresAt),
        lte(schema.allianceAshedCredentials.tokenExpiresAt, horizon),
        or(
          isNull(schema.allianceAshedCredentials.expiryNoticeStage),
          eq(schema.allianceAshedCredentials.expiryNoticeStage, "upcoming"),
        ),
      ),
    );

  let notified = 0;
  for (const row of rows) {
    const expiresAt = row.tokenExpiresAt!;
    const due = allianceCredentialNoticeDue(
      allianceCredentialExpiryStage(expiresAt, now),
      row.sentStage,
    );
    if (!due) continue;

    const [claimed] = await db
      .update(schema.allianceAshedCredentials)
      .set({ expiryNoticeStage: due, expiryNoticeSentAt: now })
      .where(
        and(
          eq(schema.allianceAshedCredentials.allianceId, row.allianceId),
          eq(schema.allianceAshedCredentials.tokenExpiresAt, expiresAt),
          row.sentStage
            ? eq(schema.allianceAshedCredentials.expiryNoticeStage, row.sentStage)
            : isNull(schema.allianceAshedCredentials.expiryNoticeStage),
        ),
      )
      .returning({ allianceId: schema.allianceAshedCredentials.allianceId });
    if (!claimed) continue;

    const officers = await listAllianceCredentialOfficers(row.allianceId);
    const officerLocales = await loadUserLocaleStates(officers.map((o) => o.hqUserId));
    const ctx: AllianceCredentialNoticeContext = {
      allianceId: row.allianceId,
      allianceTag: row.tag?.trim() || row.allianceId,
      allianceName: row.name?.trim() || null,
      stage: due,
      expiresAt,
      officerCount: officers.length,
    };

    // Per-recipient fingerprints let a retry re-send only to recipients that failed.
    const fingerprint = `alliance-ashed-token:${row.allianceId}:${due}:${expiresAt.toISOString()}`;
    let delivered = true;
    for (const { email: to, hqUserId } of officers) {
      const officerFingerprint = `${fingerprint}:officer:${to.toLowerCase()}`;
      if (!(await claimOpsAlertFingerprint(officerFingerprint))) continue;
      try {
        const locale = officerLocales.get(hqUserId)?.locale ?? "en-US";
        await sendOfficerEmail({ to, ...buildOfficerAllianceCredentialEmail(ctx, locale) });
      } catch (error) {
        delivered = false;
        await releaseOpsAlertFingerprint(officerFingerprint);
        console.error("[alliance-credential-expiry] officer notice failed", row.allianceId, error);
      }
    }
    const maintainers = await emailPlatformMaintainers({
      ...buildMaintainerAllianceCredentialEmail(ctx),
      dedupeFingerprint: fingerprint,
    });
    if (!maintainers.sent && maintainers.recipientCount > 0) delivered = false;

    if (!delivered) {
      await db
        .update(schema.allianceAshedCredentials)
        .set({ expiryNoticeStage: row.sentStage, expiryNoticeSentAt: null })
        .where(
          and(
            eq(schema.allianceAshedCredentials.allianceId, row.allianceId),
            eq(schema.allianceAshedCredentials.tokenExpiresAt, expiresAt),
            eq(schema.allianceAshedCredentials.expiryNoticeStage, due),
          ),
        );
      continue;
    }
    notified += 1;
  }

  return { checked: rows.length, notified };
}
