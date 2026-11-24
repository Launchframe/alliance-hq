import "server-only";

import { eq } from "drizzle-orm";

import type { AppLocale } from "@/i18n/routing";
import { getDb, schema } from "@/lib/db";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { listGuildsWithBankingChannel } from "@/lib/battle-plan/discord-announcements.server";
import {
  formatNotificationNumber,
  notificationTranslator,
  resolveRecipientLocale,
} from "@/lib/notifications/locale.server";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";

import type { BankDropSummary } from "./drop-summary.shared";

function resolveEmailFromAddress(): string {
  return (
    process.env.EMAIL_FROM ??
    (process.env.NODE_ENV === "production"
      ? PRODUCTION_EMAIL_FROM
      : RESEND_DEV_EMAIL_FROM)
  );
}

function formatCG(value: number): string {
  return value.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Discord notification
// ---------------------------------------------------------------------------

function buildDiscordMessage(summary: BankDropSummary): string {
  const { bank } = summary;
  const lines: string[] = [
    `📦 **Bank Dropped** — Lv${bank.level} (${bank.coordX}, ${bank.coordY})`,
    "",
    `⏱️ Open for: **${summary.durationLabel}**`,
    `📊 Deposits processed: **${summary.totalDeposits}** totaling **${formatCG(summary.totalCrystalGoldDeposited)} CG**`,
    `💰 Interest earned: **${formatCG(summary.totalInterestEarned)} CG** (${summary.investmentReturnPercent}% ROI)`,
    `🏴‍☠️ Crystal gold looted: **${formatCG(summary.crystalGoldLooted)} CG**`,
    `📉 Slippage: **${summary.slippagePercent}%**`,
  ];

  if (summary.lockedCount > 0) {
    lines.push(
      `⚠️ Still deposited at drop: ${summary.lockedCount} deposits (${formatCG(summary.lockedValue)} CG)`,
    );
  }

  return lines.join("\n");
}

export async function sendBankDropDiscordNotification(
  allianceId: string,
  summary: BankDropSummary,
): Promise<{ posted: number }> {
  const targets = await listGuildsWithBankingChannel();
  const channels = targets
    .filter((t) => t.allianceId === allianceId)
    .map((t) => t.channelId);

  if (channels.length === 0) return { posted: 0 };

  const message = buildDiscordMessage(summary);
  let posted = 0;
  for (const channelId of channels) {
    const ok = await postDiscordChannelMessage(channelId, message);
    if (ok) posted++;
  }
  return { posted };
}

// ---------------------------------------------------------------------------
// Email notification
// ---------------------------------------------------------------------------

export function buildBankDropEmail(
  summary: BankDropSummary,
  locale: AppLocale = "en-US",
): { subject: string; html: string; text: string } {
  const t = notificationTranslator(locale, "notificationMessages.bankDrop");
  const { bank } = summary;
  const num = (value: number) => formatNotificationNumber(value, locale);
  const where = {
    level: String(bank.level),
    x: String(bank.coordX),
    y: String(bank.coordY),
  };
  const rows: [string, string][] = [
    [t("durationOpen"), summary.durationLabel],
    [
      t("depositsProcessed"),
      t("depositsValue", {
        count: num(summary.totalDeposits),
        amount: num(summary.totalCrystalGoldDeposited),
      }),
    ],
    [
      t("interestEarned"),
      t("interestValue", {
        amount: num(summary.totalInterestEarned),
        roi: String(summary.investmentReturnPercent),
      }),
    ],
    [t("looted"), t("amountCG", { amount: num(summary.crystalGoldLooted) })],
    [t("slippage"), t("percent", { value: String(summary.slippagePercent) })],
  ];
  if (summary.lockedCount > 0) {
    rows.push([
      t("stillDeposited"),
      t("lockedValue", {
        count: num(summary.lockedCount),
        amount: num(summary.lockedValue),
      }),
    ]);
  }

  const subject = t("subject", { ...where, duration: summary.durationLabel });
  const text = [
    t("textHeading", where),
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    t("signature"),
  ].join("\n");

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${label}</td><td style="padding:4px 0;font-weight:600;">${value}</td></tr>`,
    )
    .join("");

  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;">📦 ${t("htmlHeading")}</h2>
  <p style="margin:0 0 12px;color:#374151;">
    ${t("location", where)}
  </p>
  <table style="border-collapse:collapse;font-size:14px;">${tableRows}</table>
  <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">${t("signature")}</p>
</div>`.trim();

  return { subject, html, text };
}

export async function sendBankDropEmailNotification(
  allianceId: string,
  summary: BankDropSummary,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: false };

  const db = getDb();
  const [alliance] = await db
    .select({
      ownerEmail: schema.alliances.ownerEmail,
      ownerHqUserId: schema.alliances.ownerHqUserId,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const to = alliance?.ownerEmail?.trim();
  if (!to) return { sent: false };

  const from = resolveEmailFromAddress();
  const { subject, html, text } = buildBankDropEmail(
    summary,
    await resolveRecipientLocale({ hqUserId: alliance?.ownerHqUserId, email: to }),
  );

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    return { sent: res.ok };
  } catch {
    return { sent: false };
  }
}
