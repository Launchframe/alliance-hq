import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { postDiscordChannelMessage } from "@/lib/discord/post-message.server";
import { listGuildsWithBankingChannel } from "@/lib/battle-plan/discord-announcements.server";
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
      `⚠️ Still locked at drop: ${summary.lockedCount} deposits (${formatCG(summary.lockedValue)} CG)`,
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

function buildEmailSubject(summary: BankDropSummary): string {
  const { bank } = summary;
  return `Bank Dropped: Lv${bank.level} (${bank.coordX}, ${bank.coordY}) — ${summary.durationLabel}`;
}

function buildEmailText(summary: BankDropSummary): string {
  const { bank } = summary;
  return [
    `Bank Dropped — Lv${bank.level} at (${bank.coordX}, ${bank.coordY})`,
    "",
    `Duration open: ${summary.durationLabel}`,
    `Deposits processed: ${summary.totalDeposits} totaling ${formatCG(summary.totalCrystalGoldDeposited)} CG`,
    `Interest earned: ${formatCG(summary.totalInterestEarned)} CG (${summary.investmentReturnPercent}% ROI)`,
    `Crystal gold looted: ${formatCG(summary.crystalGoldLooted)} CG`,
    `Slippage: ${summary.slippagePercent}%`,
    summary.lockedCount > 0
      ? `Still locked at drop: ${summary.lockedCount} deposits (${formatCG(summary.lockedValue)} CG)`
      : "",
    "",
    "— Alliance HQ",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildEmailHtml(summary: BankDropSummary): string {
  const { bank } = summary;
  const rows = [
    ["Duration open", summary.durationLabel],
    [
      "Deposits processed",
      `${summary.totalDeposits} totaling ${formatCG(summary.totalCrystalGoldDeposited)} CG`,
    ],
    [
      "Interest earned",
      `${formatCG(summary.totalInterestEarned)} CG (${summary.investmentReturnPercent}% ROI)`,
    ],
    ["Crystal gold looted", `${formatCG(summary.crystalGoldLooted)} CG`],
    ["Slippage", `${summary.slippagePercent}%`],
  ];

  if (summary.lockedCount > 0) {
    rows.push([
      "Still locked at drop",
      `${summary.lockedCount} deposits (${formatCG(summary.lockedValue)} CG)`,
    ]);
  }

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${label}</td><td style="padding:4px 0;font-weight:600;">${value}</td></tr>`,
    )
    .join("");

  return `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;">📦 Bank Dropped</h2>
  <p style="margin:0 0 12px;color:#374151;">
    Level ${bank.level} at (${bank.coordX}, ${bank.coordY})
  </p>
  <table style="border-collapse:collapse;font-size:14px;">${tableRows}</table>
  <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">— Alliance HQ</p>
</div>`.trim();
}

export async function sendBankDropEmailNotification(
  allianceId: string,
  summary: BankDropSummary,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: false };

  const db = getDb();
  const [alliance] = await db
    .select({ ownerEmail: schema.alliances.ownerEmail })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);

  const to = alliance?.ownerEmail?.trim();
  if (!to) return { sent: false };

  const from = resolveEmailFromAddress();
  const subject = buildEmailSubject(summary);
  const html = buildEmailHtml(summary);
  const text = buildEmailText(summary);

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
