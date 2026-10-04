"use client";

import {
  formatTrainPointCount,
} from "@/lib/trains/train-conductor-minimums.shared";
import type { ScoreLeaderboardEntry } from "@/lib/trains/score-leaderboard-podium.shared";

const WIDTH = 1080;
const HEIGHT = 1350;

export type ScoreLeaderboardShareImageInput = {
  title: string;
  subtitle: string;
  entries: ScoreLeaderboardEntry[];
  /** Locale for score formatting. */
  locale?: string;
};

function truncateName(ctx: CanvasRenderingContext2D, name: string, maxWidth: number) {
  if (ctx.measureText(name).width <= maxWidth) return name;
  let trimmed = name;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

export function renderScoreLeaderboardShareCanvas(
  input: ScoreLeaderboardShareImageInput,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create leaderboard share canvas context");
  }

  const locale = input.locale ?? "en-US";
  const entries = input.entries.slice(0, 10);

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#0d1117");
  gradient.addColorStop(0.45, "#161b22");
  gradient.addColorStop(1, "#0f2a3a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = "center";
  ctx.fillStyle = "#8b949e";
  ctx.font = "600 32px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(input.title.toUpperCase(), WIDTH / 2, 100);

  ctx.fillStyle = "#f0f6fc";
  ctx.font = "700 40px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(input.subtitle, WIDTH / 2, 160);

  const podium = [entries[1], entries[0], entries[2]] as const;
  const podiumRanks = [2, 1, 3] as const;
  const podiumY = 220;
  const slotWidth = 280;
  const gap = 36;
  const podiumWidth = slotWidth * 3 + gap * 2;
  const podiumLeft = (WIDTH - podiumWidth) / 2;
  const barHeights = { 1: 220, 2: 170, 3: 140 } as const;
  const barColors = {
    1: "#f59e0b",
    2: "#94a3b8",
    3: "#fb923c",
  } as const;

  podium.forEach((entry, index) => {
    const rank = podiumRanks[index]!;
    const left = podiumLeft + index * (slotWidth + gap);
    const barH = barHeights[rank];
    const barTop = podiumY + 160;
    const barBottom = barTop + barH;

    ctx.fillStyle = barColors[rank];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(left + 24, barTop, slotWidth - 48, barH, 18);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#0d1117";
    ctx.font = "800 48px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(String(rank), left + slotWidth / 2, barTop + 64);

    if (entry) {
      ctx.fillStyle = "#f0f6fc";
      ctx.font = "700 28px system-ui, -apple-system, Segoe UI, sans-serif";
      const name = truncateName(ctx, entry.memberName, slotWidth - 20);
      ctx.fillText(name, left + slotWidth / 2, barTop - 36);
      ctx.fillStyle = "#79c0ff";
      ctx.font = "600 24px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText(
        formatTrainPointCount(entry.score, locale),
        left + slotWidth / 2,
        barTop - 6,
      );
    } else {
      ctx.fillStyle = "rgba(139, 148, 158, 0.7)";
      ctx.font = "600 22px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("—", left + slotWidth / 2, barTop - 20);
    }

    void barBottom;
  });

  const listTop = podiumY + 420;
  const listLeft = 90;
  const listWidth = WIDTH - 180;
  const rowHeight = 64;
  const rest = entries.slice(3);

  ctx.fillStyle = "rgba(22, 27, 34, 0.92)";
  ctx.strokeStyle = "rgba(48, 54, 61, 0.9)";
  ctx.lineWidth = 2;
  const listHeight = Math.max(rest.length, 1) * rowHeight + 24;
  ctx.beginPath();
  ctx.roundRect(listLeft, listTop, listWidth, listHeight, 24);
  ctx.fill();
  ctx.stroke();

  if (rest.length === 0) {
    ctx.fillStyle = "#8b949e";
    ctx.font = "500 26px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("—", WIDTH / 2, listTop + 48);
  } else {
    rest.forEach((entry, index) => {
      const y = listTop + 20 + index * rowHeight + rowHeight / 2;
      ctx.textAlign = "left";
      ctx.fillStyle = "#8b949e";
      ctx.font = "700 26px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText(`#${entry.rank}`, listLeft + 28, y + 8);

      ctx.fillStyle = "#f0f6fc";
      ctx.font = "600 28px system-ui, -apple-system, Segoe UI, sans-serif";
      const name = truncateName(ctx, entry.memberName, listWidth - 320);
      ctx.fillText(name, listLeft + 110, y + 8);

      ctx.textAlign = "right";
      ctx.fillStyle = "#79c0ff";
      ctx.font = "700 28px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText(
        formatTrainPointCount(entry.score, locale),
        listLeft + listWidth - 28,
        y + 8,
      );
    });
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(139, 148, 158, 0.75)";
  ctx.font = "500 24px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("Alliance HQ", WIDTH / 2, HEIGHT - 48);

  return canvas;
}

export async function renderScoreLeaderboardSharePngBlob(
  input: ScoreLeaderboardShareImageInput,
): Promise<Blob> {
  const canvas = renderScoreLeaderboardShareCanvas(input);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Leaderboard share image export returned empty blob"));
      },
      "image/png",
      1,
    );
  });
}
