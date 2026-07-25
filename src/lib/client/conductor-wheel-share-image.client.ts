"use client";

const WIDTH = 1080;
const HEIGHT = 1350;
const CONFETTI_COLORS = [
  "#ff0000",
  "#ffa500",
  "#ffff00",
  "#00ff00",
  "#0000ff",
  "#4b0082",
  "#ee82ee",
  "#38bdf8",
  "#f472b6",
];

export type ConductorWheelShareImageInput = {
  title: string;
  dayLabel?: string | null;
  names: string[];
  winnerIndex: number;
  eligibilityLine?: string | null;
  statsLine?: string | null;
};

type ConfettiPiece = {
  x: number;
  y: number;
  size: number;
  rotation: number;
  color: string;
  shape: "rect" | "circle";
};

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildConfetti(seed: number, count: number): ConfettiPiece[] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () => ({
    x: random() * WIDTH,
    y: random() * HEIGHT * 0.72,
    size: 6 + random() * 14,
    rotation: random() * Math.PI,
    color: CONFETTI_COLORS[Math.floor(random() * CONFETTI_COLORS.length)]!,
    shape: random() > 0.45 ? "rect" : "circle",
  }));
}

function drawConfetti(ctx: CanvasRenderingContext2D, pieces: ConfettiPiece[]) {
  for (const piece of pieces) {
    ctx.save();
    ctx.translate(piece.x, piece.y);
    ctx.rotate(piece.rotation);
    ctx.fillStyle = piece.color;
    if (piece.shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, piece.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
    }
    ctx.restore();
  }
}

function truncateName(ctx: CanvasRenderingContext2D, name: string, maxWidth: number) {
  if (ctx.measureText(name).width <= maxWidth) return name;
  let trimmed = name;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(" ");
  let line = "";
  let currentY = y;
  for (let i = 0; i < words.length; i += 1) {
    const testLine = line ? `${line} ${words[i]}` : words[i]!;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      line = words[i]!;
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }
  return currentY;
}

export function renderConductorWheelShareCanvas(
  input: ConductorWheelShareImageInput,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create share image canvas context");
  }

  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#0d1117");
  gradient.addColorStop(0.45, "#161b22");
  gradient.addColorStop(1, "#1f1147");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const confetti = buildConfetti(
    input.names.join("|").length + input.winnerIndex * 997,
    120,
  );
  drawConfetti(ctx, confetti);

  ctx.textAlign = "center";

  ctx.fillStyle = "#8b949e";
  ctx.font = "600 34px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText(input.title.toUpperCase(), WIDTH / 2, 110);

  if (input.dayLabel) {
    ctx.fillStyle = "#f0f6fc";
    ctx.font = "700 48px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(input.dayLabel, WIDTH / 2, 180);
  }

  const reelTop = 260;
  const itemHeight = 132;
  const reelWidth = 860;
  const reelLeft = (WIDTH - reelWidth) / 2;
  const reelHeight = itemHeight * input.names.length;

  ctx.fillStyle = "rgba(22, 27, 34, 0.92)";
  ctx.strokeStyle = "rgba(48, 54, 61, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(reelLeft, reelTop, reelWidth, reelHeight, 28);
  ctx.fill();
  ctx.stroke();

  const highlightTop = reelTop + input.winnerIndex * itemHeight;
  ctx.fillStyle = "rgba(56, 139, 253, 0.14)";
  ctx.strokeStyle = "rgba(56, 139, 253, 0.75)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(reelLeft + 18, highlightTop + 10, reelWidth - 36, itemHeight - 20, 18);
  ctx.fill();
  ctx.stroke();

  input.names.forEach((name, index) => {
    const centerY = reelTop + index * itemHeight + itemHeight / 2;
    const isWinner = index === input.winnerIndex;
    ctx.fillStyle = isWinner ? "#f0f6fc" : "rgba(201, 209, 217, 0.82)";
    ctx.font = isWinner
      ? "800 58px system-ui, -apple-system, Segoe UI, sans-serif"
      : "600 40px system-ui, -apple-system, Segoe UI, sans-serif";
    const displayName = truncateName(ctx, name, reelWidth - 120);
    ctx.fillText(displayName, WIDTH / 2, centerY + (isWinner ? 18 : 12));
  });

  const fade = ctx.createLinearGradient(0, reelTop, 0, reelTop + reelHeight);
  fade.addColorStop(0, "rgba(13, 17, 23, 0.82)");
  fade.addColorStop(0.22, "rgba(13, 17, 23, 0)");
  fade.addColorStop(0.78, "rgba(13, 17, 23, 0)");
  fade.addColorStop(1, "rgba(13, 17, 23, 0.82)");
  ctx.fillStyle = fade;
  ctx.fillRect(reelLeft, reelTop, reelWidth, reelHeight);

  let contentY = reelTop + reelHeight + 70;
  if (input.eligibilityLine) {
    ctx.fillStyle = "#79c0ff";
    ctx.font = "600 34px system-ui, -apple-system, Segoe UI, sans-serif";
    contentY = wrapCanvasText(
      ctx,
      input.eligibilityLine,
      WIDTH / 2,
      contentY,
      WIDTH - 140,
      44,
    ) + 12;
  }

  if (input.statsLine) {
    ctx.fillStyle = "#8b949e";
    ctx.font = "500 28px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(input.statsLine, WIDTH / 2, contentY);
  }

  drawConfetti(ctx, confetti.slice(0, 40));

  ctx.fillStyle = "rgba(139, 148, 158, 0.75)";
  ctx.font = "500 24px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillText("Alliance HQ", WIDTH / 2, HEIGHT - 48);

  return canvas;
}

export async function renderConductorWheelSharePngBlob(
  input: ConductorWheelShareImageInput,
): Promise<Blob> {
  const canvas = renderConductorWheelShareCanvas(input);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Share image export returned empty blob"));
      },
      "image/png",
      1,
    );
  });
}

export function downloadConductorWheelSharePng(
  blob: Blob,
  filename: string,
): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
